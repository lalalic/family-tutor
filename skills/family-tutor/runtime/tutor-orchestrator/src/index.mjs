import fs from 'node:fs';
import path from 'node:path';
import { ChannelType, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.mjs';
import { CodexBackend } from './backends/codex.mjs';
import { BrowserBridge } from '../../../mcp-server/src/browser-bridge.mjs';
import { collectImageAttachments, understandImages } from './vision.mjs';
import { isAudioAttachment, transcribeAudioAttachments } from './asr.mjs';
import { reactToReceivedChildMessage } from './discord-reactions.mjs';
import { handleBrowserChildMessage } from './browser-ingress.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, canUseStatus, childProjectName, findChildByChannelName, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentMessage, renderParentNaturalText, statusCommand, statusDenialMessage, validateChildChannel } from './parent-context.mjs';
import { buildKidContext } from './runtime-context.mjs';

const configFile=process.env.FAMILY_TUTOR_CONFIG;
if(!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config=loadConfig(configFile);
const discordToken=process.env.DISCORD_BOT_TOKEN?.trim();
if(!discordToken) throw new Error('DISCORD_BOT_TOKEN is required');

const instanceDir=path.resolve(path.dirname(config.configPath),'..');
const backend=new CodexBackend(config.codex,{instanceDir});
function agentsFile(child){ return path.resolve(path.dirname(config.configPath),'..',child.id,'AGENTS.md'); }
function ensureAgents(child){ const file=agentsFile(child); if(fs.existsSync(file)) return; fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,`# ${child.name} Agent Context\n\n`,{mode:0o600}); }
function childIdFromName(name){
  return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
}
function persistConfig(){
  const serializable={...config};
  delete serializable.configPath;
  const tmp=`${config.configPath}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify(serializable,null,2)}\n`,{mode:0o600});
  fs.renameSync(tmp,config.configPath);
}
async function addKid({name}){
  const clean=String(name||'').trim();
  if(!clean) throw new Error('Kid name is required.');
  const id=childIdFromName(clean);
  if(!id) throw new Error('Please use a name with letters or numbers.');
  if(config.children.some(child=>child.id===id||child.name.toLowerCase()===clean.toLowerCase())) throw new Error('That kid is already in Family Tutor.');
  const parent=await client.channels.fetch(config.discord.parentChannelId);
  if(!parent?.guild) throw new Error('Could not add kid right now.');
  const existing=parent.guild.channels.cache.find(channel=>channel.type===ChannelType.GuildText&&channel.name===id);
  if(!existing){
    await parent.guild.channels.create({name:id,type:ChannelType.GuildText,parent:parent.parentId||undefined,reason:`Family Tutor kid ${clean}`});
  }
  const child={id,name:clean};
  config.children.push(child);
  ensureAgents(child);
  persistConfig();
  return child;
}
async function deleteKid({childId}){
  const index=config.children.findIndex(child=>child.id===childId);
  if(index<0) throw new Error('Kid was not found.');
  config.children.splice(index,1);
  persistConfig();
  return {childId};
}
for(const child of config.children) ensureAgents(child);
const queues=new Map();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
let browserBridge=null;

function turnPrompt(child,message){ return buildKidContext({childId:child.id,text:message}); }
function parseTutorText(text){
  const parent=text.match(/<FAMILY_TUTOR_PARENT>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_PARENT>/i);
  const memory=text.match(/<FAMILY_TUTOR_MEMORY>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_MEMORY>/i);
  const rollover=/<FAMILY_TUTOR_ROLLOVER\s*\/>/i.test(text);
  const childText=text
    .replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/ig,'')
    .replace(/<FAMILY_TUTOR_MEMORY>[\s\S]*?<\/FAMILY_TUTOR_MEMORY>/ig,'')
    .replace(/<FAMILY_TUTOR_ROLLOVER\s*\/>/ig,'')
    .trim();
  return {childText,parentText:parent?.[1]?.trim()||null,memoryText:memory?.[1]?.trim()||null,rollover};
}
function writeAgents(child,text){
  if(!text) return;
  if(Buffer.byteLength(text,'utf8')>100000) throw new Error(`AGENTS.md update for ${child.id} exceeds 100 KB`);
  const file=agentsFile(child); const tmp=`${file}.tmp`;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(tmp,`${text.trim()}\n`,{mode:0o600});
  fs.renameSync(tmp,file);
}
async function applyTutorSideEffects(child,parsed){
  if(parsed.memoryText) writeAgents(child,parsed.memoryText);
  if(parsed.rollover) await backend.newThread({childId:child.id});
}
async function sendChunks(channel,text){ let remaining=text; while(remaining.length>1900){let split=remaining.lastIndexOf('\n',1900); if(split<800) split=1900; await channel.send(remaining.slice(0,split)); remaining=remaining.slice(split).trimStart();} if(remaining) await channel.send(remaining); }
function collectAttachments(message){
  return [...message.attachments.values()].slice(0,4).map(a=>({
    url:a.url,
    name:a.name||`attachment-${a.id}`,
    mimeType:a.contentType||'',
    size:Number(a.size||0),
  }));
}
async function replyToMessage(message,text){
  let remaining=String(text||'').trim();
  let first=true;
  while(remaining){
    let split=remaining.length>1900?remaining.lastIndexOf('\n',1900):remaining.length;
    if(split<800&&remaining.length>1900) split=1900;
    const chunk=remaining.slice(0,split);
    if(first) await message.reply({content:chunk,failIfNotExists:false});
    else await message.channel.send(chunk);
    remaining=remaining.slice(split).trimStart(); first=false;
  }
}
async function sendAssistantOutputs(channel,outputs=[]){
  for(const output of outputs.slice(0,6)){
    if(!output?.data?.length) continue;
    try{
      await channel.send({files:[{attachment:output.data,name:output.name||'attachment'}]});
    }catch(error){
      console.error('[family-tutor] Discord output attachment failed',error);
      await channel.send(`I created **${output.name||'a file'}**, but Discord could not accept the attachment.`).catch(()=>{});
    }
  }
}
async function handleChildMessage(message,child){
  const incoming=message.content.trim();
  const attachments=collectAttachments(message);
  if(!incoming && !attachments.length) return;
  await message.channel.sendTyping();
  const audioAttachments=attachments.filter(isAudioAttachment);
  const nonAudioAttachments=attachments.filter(a=>!isAudioAttachment(a));
  let voiceTranscript=null;
  if(audioAttachments.length){
    try{
      voiceTranscript=await transcribeAudioAttachments(audioAttachments);
    }catch(error){
      console.error(`[family-tutor] ${child.id} local ASR failed`,error);
      return message.reply('I received your voice message, but I could not transcribe it locally. Please try again or send it as text.');
    }
  }
  const voiceBlock=voiceTranscript?`[VOICE MESSAGE TRANSCRIPT — preserve the student's spoken meaning; do not judge grammar or writing quality from this transcript]\n${voiceTranscript}\n[/VOICE MESSAGE TRANSCRIPT]`:'';
  const studentMessage=[incoming,voiceBlock].filter(Boolean).join('\n\n') || 'Please help me understand the attached file(s).';
  let result;
  try{
    result=await backend.turn({
      prompt:turnPrompt(child,studentMessage),
      childId:child.id,
      attachments:nonAudioAttachments,
    });
  }catch(error){
    const imageAttachments=collectImageAttachments(message);
    const onlyImages=nonAudioAttachments.length>0 && imageAttachments.length===nonAudioAttachments.length;
    if(!onlyImages) throw error;
    console.warn(`[family-tutor] ${child.id} direct Codex attachment failed; using local image fallback`,error?.message||error);
    let imageContext;
    try{ imageContext=await understandImages(imageAttachments,incoming); }
    catch(visionError){
      console.error(`[family-tutor] ${child.id} image fallback failed`,visionError);
      return message.reply('I received your file, but Codex and the local image fallback both failed. Please try again or send the question as text.');
    }
    const grounded=`${studentMessage}\n\n[GROUNDING FROM STUDENT IMAGE — fallback visual analysis]\n${imageContext}\n[/GROUNDING FROM STUDENT IMAGE]`;
    result=await backend.turn({prompt:turnPrompt(child,grounded),childId:child.id});
  }
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
  await sendChunks(message.channel,parsed.childText||result.text);
  await sendAssistantOutputs(message.channel,result.outputs);
  if(parsed.parentText){ const parent=await client.channels.fetch(config.discord.parentChannelId); if(parent?.isTextBased()) await sendChunks(parent,`📘 **${child.name}**\n${parsed.parentText}`); }
}


async function resolveMentionedChild(command){
  if(!command?.channelMentionId) return null;
  const channel=await client.channels.fetch(command.channelMentionId);
  const child=findChildByChannelName(config.children,channel?.name);
  if(!child) throw new Error('Family Tutor configuration error: Discord channel #' + (channel?.name||command.channelMentionId) + ' must match ChatGPT Project ' + childProjectName(channel?.name||'') + '.');
  validateChildChannel(child,channel);
  return child;
}
function learnerMemory(child){ try{return fs.readFileSync(agentsFile(child),'utf8');}catch{return '';} }

function childChannelFor(message,child){
  return message.guild?.channels?.cache?.find(channel=>channel.type===ChannelType.GuildText&&channel.name===child.id)||null;
}
async function runParentTurn(message,child,prompt,{reminder=false}={}){
  if(reminder){
    const target=childChannelFor(message,child);
    if(!target?.isTextBased()) throw new Error(`Configured child channel #${child.id} is unavailable.`);
    if(browserBridge){
      await browserBridge.turn({childId:child.id,prompt,origin:{channelId:target.id,messageId:message.id,threadId:null},reply:async text=>sendChunks(target,text)});
      return sendChunks(message.channel,`✅ Reminder sent to **${child.name}**.`);
    }
    const result=await backend.turn({prompt,childId:child.id});
    const parsed=parseTutorText(result.text);
    await applyTutorSideEffects(child,parsed);
    await sendChunks(target,parsed.childText||result.text);
    await sendAssistantOutputs(target,result.outputs);
    await sendChunks(message.channel,`✅ Reminder sent to **${child.name}**.`);
    return;
  }
  if(browserBridge){
    await browserBridge.turn({childId:child.id,prompt,origin:{channelId:message.channelId,messageId:message.id,threadId:null}});
    return;
  }
  const result=await backend.turn({prompt,childId:child.id});
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
  return sendChunks(message.channel,parsed.childText||result.text);
}

async function handleParentControl(message){
  if(!isAuthorizedParent(message,config)) return;
  const command=parseParentMessage(message.content,config.children);
  if(!command) return message.reply('Mention one child channel naturally, for example: `how is #sammy doing recently?`');
  const child=await resolveMentionedChild(command);
  if(!child) return message.reply('Mention one configured child channel.');
  const value=command.command==='parent-query'?renderParentNaturalText(command.value,command.channelMentionId,child.name):command.value;
  if(!value) return message.reply('Please include the question or guidance.');
  const prompt=buildParentContextPrompt({child,command:command.command,value,authorId:message.author.id,messageId:message.id,memory:learnerMemory(child)});
  return runParentTurn(message,child,prompt,{reminder:command.command==='!remind'});
}

async function statusForChild(child){
  const prompt=buildSlashStatusPrompt({child,memory:learnerMemory(child)});
  if(browserBridge){
    let latest='';
    await browserBridge.turn({childId:child.id,prompt,origin:{channelId:config.discord.parentChannelId,messageId:'status-'+Date.now(),threadId:null},reply:async(text)=>{latest=text;}});
    return formatSlashStatus(child,latest);
  }
  const result=await backend.turn({prompt,childId:child.id});
  return formatSlashStatus(child,result.text);
}
async function handleStatusInteraction(interaction){
  if(!canUseStatus({channelId:interaction.channelId},config)) return interaction.reply({content:statusDenialMessage(),ephemeral:true});
  const requested=interaction.options.getChannel('child-channel');
  let child=null;
  if(requested){
    child=findChildByChannelName(config.children,requested.name);
    if(!child) return interaction.reply({content:'Configuration error: #'+requested.name+' must map to '+childProjectName(requested.name)+'.',ephemeral:true});
    try{validateChildChannel(child,requested);}catch(error){return interaction.reply({content:error.message,ephemeral:true});}
  }
  await interaction.deferReply();
  const statuses=[];
  for(const target of child?[child]:config.children) statuses.push(await serialize(target.id,()=>statusForChild(target)));
  return interaction.editReply(formatSlashOverview(statuses));
}
async function syncSlashCommands(applicationId){
  const rest=new REST({version:'10'}).setToken(discordToken);
  const command=new SlashCommandBuilder().setName(statusCommand.name).setDescription(statusCommand.description).addChannelOption(option=>option.setName('child-channel').setDescription('Child channel, e.g. #sammy').setRequired(false));
  await rest.put(Routes.applicationCommands(applicationId),{body:[command.toJSON()]});
}

function serialize(childId,work){ const prev=queues.get(childId)||Promise.resolve(); const next=prev.catch(()=>{}).then(work).finally(()=>{if(queues.get(childId)===next) queues.delete(childId)}); queues.set(childId,next); return next; }

client.once(Events.ClientReady,c=>{
  console.log(`[family-tutor-orchestrator] ready as ${c.user.tag}`);
  syncSlashCommands(c.user.id).then(()=>console.log('[family-tutor-orchestrator] /status command synced')).catch(error=>console.error('[family-tutor] slash command sync failed',error));
});
client.on(Events.InteractionCreate,interaction=>{
  if(!interaction.isChatInputCommand()||interaction.commandName!==statusCommand.name) return;
  handleStatusInteraction(interaction).catch(error=>{
    console.error('[family-tutor] /status failed',error);
    const reply={content:'Status is temporarily unavailable. Please try again shortly.',ephemeral:true};
    if(interaction.deferred||interaction.replied) interaction.editReply(reply).catch(()=>{}); else interaction.reply(reply).catch(()=>{});
  });
});
client.on(Events.MessageCreate,message=>{
  if(message.author.bot) return;
  const child=findChildByChannelName(config.children,message.channel?.name);
  if(child){
    try{validateChildChannel(child,message.channel);}catch(error){console.error('[family-tutor] child channel configuration error',error); message.reply(error.message).catch(()=>{}); return;}
    reactToReceivedChildMessage(message,child.id);
    const handler=browserBridge?handleBrowserChildMessage:handleChildMessage;
    serialize(child.id,()=>browserBridge?handler(message,child,browserBridge):handler(message,child)).catch(error=>{console.error(`[family-tutor] ${child.id} turn failed`,error); message.reply('The tutor is temporarily unavailable. Please try again shortly.').catch(()=>{});});
    return;
  }
  if(config.discord.parentChannelId && message.channelId===config.discord.parentChannelId){
    const command=parseParentMessage(message.content,config.children);
    const key=command?.channelMentionId||'parent-control';
    serialize(key,()=>handleParentControl(message)).catch(error=>{console.error('[family-tutor] parent control failed',error); message.reply(error.message.includes('configuration error')?error.message:'Parent control is temporarily unavailable.').catch(()=>{});});
  }
});
if(config.browserBridge?.enabled){
  browserBridge=new BrowserBridge({
    instanceDir,
    children:config.children,
    host:config.browserBridge.host||'127.0.0.1',
    port:config.browserBridge.port||43117,
    token:process.env.FAMILY_TUTOR_BRIDGE_TOKEN?.trim()||null,
    replyToDiscord:async({origin,text})=>{
      const channel=await client.channels.fetch(origin.channelId);
      if(!channel?.isTextBased()) throw new Error('originating Discord channel is unavailable');
      const original=await channel.messages.fetch(origin.messageId);
      await replyToMessage(original,text);
    },
    addChild:addKid,
    deleteChild:deleteKid,
  });
  await browserBridge.start();
  console.log(`[family-tutor-orchestrator] ChatGPT browser bridge listening on ${browserBridge.endpoint()}`);
}
for(const signal of ['SIGINT','SIGTERM']){
  process.once(signal,async()=>{
    try{ await browserBridge?.stop(); }catch(error){ console.error('[family-tutor] browser bridge shutdown failed',error); }
    client.destroy();
    process.exit(0);
  });
}
await client.login(discordToken);
