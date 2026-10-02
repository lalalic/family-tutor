import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ChannelType, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.mjs';
import { CodexBackend } from './backends/codex.mjs';
import { BrowserBridge } from '../../../mcp-server/src/browser-bridge.mjs';
import { NeoYTutorClient } from './neoy-tutor.mjs';
import { BrowserWorkspaceTutorClient } from './browser-workspace-tutor.mjs';
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

const setupGreetingFile=path.join(instanceDir,'.setup-greetings.json');
const bootstrapControlPort=Number(process.env.FAMILY_TUTOR_BOOTSTRAP_PORT||43118);
let bootstrapControlServer=null;

function titleFromChannel(name){
  return String(name||'').split(/[-_ ]+/).filter(Boolean).map(part=>part.slice(0,1).toUpperCase()+part.slice(1)).join(' ');
}
function discoverFamilyFromGuild(guild){
  const text=[...guild.channels.cache.values()]
    .filter(channel=>channel.type===ChannelType.GuildText)
    .sort((a,b)=>(a.rawPosition??a.position??0)-(b.rawPosition??b.position??0)||a.name.localeCompare(b.name));
  const exactParent=/^(?:parents?|parent[-_ ]?(?:chat|room|channel)?)$/i;
  const parent=text.find(channel=>exactParent.test(channel.name))||text.find(channel=>/parent/i.test(channel.name))||null;
  const reserved=/^(?:general|random|welcome|rules|announcements?|bot|bots?|tutor|family-tutor)$/i;
  const sameCategory=parent?.parentId?text.filter(channel=>channel.parentId===parent.parentId):text;
  let candidates=sameCategory.filter(channel=>channel.id!==parent?.id&&!reserved.test(channel.name)&&!/parent/i.test(channel.name));
  if(!candidates.length&&sameCategory!==text) candidates=text.filter(channel=>channel.id!==parent?.id&&!reserved.test(channel.name)&&!/parent/i.test(channel.name));
  const children=candidates.map(channel=>({
    id:childIdFromName(channel.name),
    name:titleFromChannel(channel.name),
    channelId:channel.id,
    channelName:channel.name,
  })).filter(child=>child.id);
  return {
    discovery:parent&&children.length?'automatic':'needs_review',
    parent:parent?{channelId:parent.id,channelName:parent.name}:null,
    children,
  };
}
function applyDiscoveredFamily(family){
  if(family.discovery!=='automatic') return false;
  const existing=new Map(config.children.map(child=>[child.id,child]));
  config.discord={...(config.discord||{}),parentChannelId:family.parent.channelId};
  config.children=family.children.map(child=>({
    ...(existing.get(child.id)||{}),
    id:child.id,
    name:existing.get(child.id)?.name||child.name,
  }));
  persistConfig();
  return true;
}
function logicalFamily(family){
  return {
    discovery:family.discovery,
    parent:family.parent?{channelName:family.parent.channelName}:null,
    children:family.children.map(child=>({id:child.id,name:child.name,channelName:child.channelName})),
  };
}
function loadGreetingState(){ try{return JSON.parse(fs.readFileSync(setupGreetingFile,'utf8'));}catch{return {parent:false,children:{}};} }
function saveGreetingState(state){ const tmp=`${setupGreetingFile}.tmp`; fs.writeFileSync(tmp,`${JSON.stringify(state,null,2)}\n`,{mode:0o600}); fs.renameSync(tmp,setupGreetingFile); }
async function discordSetupStatus(){
  let parent=null;
  try{ parent=await client.channels.fetch(config.discord.parentChannelId); }catch{}
  const guild=parent?.guild||null;
  const children=config.children.map(child=>{
    const channel=guild?.channels?.cache?.find(candidate=>candidate.type===ChannelType.GuildText&&candidate.name===child.id)||null;
    return {id:child.id,name:child.name,channelReady:Boolean(channel)};
  });
  const parentReady=Boolean(parent?.isTextBased?.());
  return {discordReady:parentReady&&children.length>0&&children.every(child=>child.channelReady),parentReady,children};
}
async function sendSetupGreetings(){
  const status=await discordSetupStatus();
  if(!status.discordReady) throw new Error('Discord channels are not ready yet.');
  const state=loadGreetingState();
  const parent=await client.channels.fetch(config.discord.parentChannelId);
  const guild=parent.guild;
  for(const child of config.children){
    if(state.children?.[child.id]) continue;
    const channel=guild.channels.cache.find(candidate=>candidate.type===ChannelType.GuildText&&candidate.name===child.id);
    if(!channel?.isTextBased()) throw new Error(`Discord channel for ${child.name} is not ready yet.`);
    await channel.send(`Hi ${child.name}! 👋 Family Tutor is ready. Ask homework questions here, or send a photo, file, or voice message. I’ll reply in this channel.`);
    state.children={...(state.children||{}),[child.id]:true};
    saveGreetingState(state);
  }
  if(!state.parent){
    const example=config.children[0]?.id||'sammy';
    await parent.send(`Family Tutor is ready. 👋 Use this channel to check learning status or send reminders. Try \`how is #${example} doing?\` or \`remind #${example} to do homework\`.`);
    state.parent=true; saveGreetingState(state);
  }
  return {alreadyComplete:Boolean(state.parent&&config.children.every(child=>state.children?.[child.id])),greetingsSent:true};
}
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
const queues=new Map();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
let browserBridge=null;
let tutorClient=null;
let tutorTransport=null;

function turnPrompt(child,message,correlationId=null){ return buildKidContext({childName:child.name,text:message,correlationId}); }
function parseTutorText(text){
  const parent=text.match(/<FAMILY_TUTOR_PARENT>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_PARENT>/i);
  const rollover=/<FAMILY_TUTOR_ROLLOVER\s*\/>/i.test(text);
  const childText=text
    .replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/ig,'')
    .replace(/<FAMILY_TUTOR_ROLLOVER\s*\/>/ig,'')
    .trim();
  return {childText,parentText:parent?.[1]?.trim()||null,rollover};
}
async function applyTutorSideEffects(child,parsed){
  if(parsed.rollover){
    if(tutorClient){
      await tutorClient.resetThread({
        learner:child.id,
        projectName:child.name||child.id,
        instructions:await tutorProjectInstructions(child),
        initialPrompt:`Start a fresh Family Tutor thread for ${child.name||child.id}. Use the Project Instructions. Reply only with READY.`,
      });
    }else{
      await backend.newThread({childId:child.id});
    }
  }
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
async function handleTutorChildMessage(message,child){
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
      console.error(`[family-tutor] ${child.id} ASR failed`,error);
      return message.reply('I received your voice message, but I could not transcribe it. Please try again or send it as text.');
    }
  }
  const voiceBlock=voiceTranscript?`[VOICE MESSAGE TRANSCRIPT — preserve the student's spoken meaning; do not judge grammar or writing quality from this transcript]
${voiceTranscript}
[/VOICE MESSAGE TRANSCRIPT]`:'';
  const studentMessage=[incoming,voiceBlock].filter(Boolean).join('\\n\\n') || 'Please help me understand the attached file(s).';
  const turn=browserBridge.beginExternalTurn({
    childId:child.id,
    origin:{channelId:message.channelId,messageId:message.id,threadId:null},
  });
  let result;
  try{
    result=await tutorClient.turn({
      learner:child.id,
      prompt:turnPrompt(child,studentMessage,turn.correlationId),
      attachments:nonAudioAttachments,
    });
  }catch(error){
    await browserBridge.fail(turn.correlationId,error).catch(()=>{});
    throw error;
  }
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
  await browserBridge.reply(turn.correlationId,parsed.childText||result.text,{final:true});
  if(parsed.parentText){
    const parent=await client.channels.fetch(config.discord.parentChannelId);
    if(parent?.isTextBased()) await sendChunks(parent,`📘 **${child.name}**
${parsed.parentText}`);
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
      console.error(`[family-tutor] ${child.id} ASR failed`,error);
      return message.reply('I received your voice message, but I could not transcribe it. Please try again or send it as text.');
    }
  }
  const voiceBlock=voiceTranscript?`[VOICE MESSAGE TRANSCRIPT — preserve the student's spoken meaning; do not judge grammar or writing quality from this transcript]\n${voiceTranscript}\n[/VOICE MESSAGE TRANSCRIPT]`:'';
  const studentMessage=[incoming,voiceBlock].filter(Boolean).join('\\n\\n') || 'Please help me understand the attached file(s).';
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
const FAMILY_TUTOR_SKILL_ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../..');
const LEARNER_PROFILE_TEMPLATE_FILE=path.join(FAMILY_TUTOR_SKILL_ROOT,'setup','learner-profile-template.md');
const BOOTSTRAP_FILE=path.join(FAMILY_TUTOR_SKILL_ROOT,'bootstrap','latest.md');

function readCanonicalTutorAssets(){
  const profileTemplate=fs.readFileSync(LEARNER_PROFILE_TEMPLATE_FILE,'utf8').trim();
  const bootstrap=fs.readFileSync(BOOTSTRAP_FILE,'utf8').trim();
  if(!profileTemplate||!bootstrap) throw new Error('Family Tutor canonical setup assets are missing');
  return {profileTemplate,bootstrap};
}

async function tutorProjectInstructions(child){
  const {profileTemplate,bootstrap}=readCanonicalTutorAssets();
  const value=(field,fallback='Not specified')=>{
    const raw=String(field??'').trim();
    return raw||fallback;
  };
  const profile=profileTemplate
    .replaceAll('<STUDENT_NAME>',value(child.name,child.id))
    .replaceAll('<NAME>',value(child.name,child.id))
    .replaceAll('<PREFERRED_NAME>',value(child.preferredName||child.name,child.id))
    .replaceAll('<GRADE_OR_LEVEL>',value(child.grade||child.level))
    .replaceAll('<LEVEL>',value(child.grade||child.level))
    .replaceAll('<LANGUAGE>',value(child.language))
    .replaceAll('<INTERESTS>',value(child.interests))
    .replaceAll('<INTEREST>',value(child.interests))
    .replaceAll('<STRENGTHS>',value(child.strengths))
    .replaceAll('<LEARNING_GOALS>',value(child.learningGoals||child.goals))
    .replaceAll('<GOAL>',value(child.learningGoals||child.goals))
    .replaceAll('<PREFERENCE>',value(child.learningPreferences||child.preferences))
    .replaceAll('<PARENT_PREFERENCE>',value(child.parentPreferences||child.boundaries))
    .replaceAll('<SUBJECT>',value(child.subjects||child.courses));
  return `${profile}\n\n---\n\n${bootstrap}`;
}

async function ensureTutorLearners(status){
  const bindings=new Map((status?.bindings||[]).map(binding=>[binding.learner,binding]));
  for(const child of config.children){
    const existing=bindings.get(child.id);
    if(existing?.project_id && existing?.thread_url) continue;
    const result=await tutorClient.setup({
      learner:child.id,
      projectName:child.name||child.id,
      instructions:await tutorProjectInstructions(child),
      initialPrompt:`Initialize ${child.name||child.id}'s Family Tutor learning thread. Use the Project Instructions. Reply only with READY.`,
    });
    bindings.set(child.id,{
      learner:child.id,
      project_id:result.project_id,
      project_url:result.project_url,
      thread_url:result.thread_url,
      target_id:result.target_id,
    });
    console.log(`[family-tutor-orchestrator] Tutor initialized ${child.id} in ChatGPT Project ${result.project_id} (${result.project_reused?'reused':'created'})`);
  }
  return [...bindings.values()];
}

async function finalizeBootstrapForGuild({guildId,sessionId}){
  if(!client.isReady()) throw new Error('Discord client is not ready yet.');
  let resolvedGuildId=String(guildId||'').trim();
  if(!resolvedGuildId && config.discord?.parentChannelId){
    const parent=await client.channels.fetch(config.discord.parentChannelId);
    resolvedGuildId=String(parent?.guild?.id||'');
  }
  if(!resolvedGuildId) throw new Error('Discord guild id is unavailable.');
  const guild=await client.guilds.fetch(resolvedGuildId);
  await guild.channels.fetch();
  const family=discoverFamilyFromGuild(guild);
  if(family.discovery!=='automatic'){
    return {status:'needs_review',sessionId,family:logicalFamily(family)};
  }
  applyDiscoveredFamily(family);
  let bindings=[];
  if(tutorClient){
    const status=await tutorClient.status();
    bindings=await ensureTutorLearners(status);
  }
  const greetings=await sendSetupGreetings();
  return {
    status:'ready',
    sessionId,
    family:logicalFamily(family),
    learners:bindings.map(binding=>({learner:binding.learner,projectReady:Boolean(binding.project_id&&binding.thread_url)})),
    greetings,
  };
}

function startBootstrapControl(){
  if(bootstrapControlServer) return bootstrapControlServer;
  bootstrapControlServer=http.createServer(async(req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
    const send=(status,body)=>{const text=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(text),'cache-control':'no-store'});res.end(text);};
    if(req.method==='GET'&&url.pathname==='/health') return send(200,{ok:true,service:'family-tutor-bootstrap-control'});
    if(req.method==='POST'&&url.pathname==='/bootstrap/discover'){
      let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>256*1024){res.destroy();return;}}
      try{
        const body=raw?JSON.parse(raw):{};
        const result=await finalizeBootstrapForGuild({guildId:body.guild_id||'',sessionId:body.session_id||null});
        return send(result.status==='ready'?200:409,result);
      }catch(error){
        console.error('[family-tutor] bootstrap discovery failed',error);
        return send(500,{error:String(error?.message||error)});
      }
    }
    return send(404,{error:'not_found'});
  });
  bootstrapControlServer.listen(bootstrapControlPort,'127.0.0.1',()=>console.log(`[family-tutor-orchestrator] bootstrap control listening on http://127.0.0.1:${bootstrapControlPort}`));
  return bootstrapControlServer;
}

function childChannelFor(message,child){
  return message.guild?.channels?.cache?.find(channel=>channel.type===ChannelType.GuildText&&channel.name===child.id)||null;
}
async function runParentTurn(message,child,prompt,{attachments=[]}={}){
  if(tutorClient){
    const turn=browserBridge.beginExternalTurn({
      childId:child.id,
      origin:{channelId:message.channelId,messageId:message.id,threadId:null},
    });
    const correlatedPrompt=prompt.replace(
      /<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/,
      (_all,jsonText)=>{
        const envelope=JSON.parse(jsonText);
        envelope.data={correlationId:turn.correlationId,...envelope.data};
        return '<FAMILY_TUTOR_CONTEXT>\n'+JSON.stringify(envelope)+'\n</FAMILY_TUTOR_CONTEXT>';
      }
    );
    let result;
    try{
      result=await tutorClient.turn({learner:child.id,prompt:correlatedPrompt,attachments});
    }catch(error){
      await browserBridge.fail(turn.correlationId,error).catch(()=>{});
      throw error;
    }
    const parsed=parseTutorText(result.text);
    await applyTutorSideEffects(child,parsed);
    return browserBridge.reply(turn.correlationId,parsed.childText||result.text,{final:true});
  }
  if(browserBridge){
    await browserBridge.turn({childId:child.id,prompt,attachments,origin:{channelId:message.channelId,messageId:message.id,threadId:null}});
    return;
  }
  const result=await backend.turn({prompt,childId:child.id,attachments});
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
  const attachments=collectAttachments(message);
  const audioAttachments=attachments.filter(isAudioAttachment);
  const nonAudioAttachments=attachments.filter(a=>!isAudioAttachment(a));
  let voiceTranscript=null;
  if(audioAttachments.length) voiceTranscript=await transcribeAudioAttachments(audioAttachments);
  const targetChannelId=browserBridge?.channelHandle(command.channelMentionId)||'';
  const normalizedMessage=renderParentNaturalText(message.content,command.channelMentionId,child.id,targetChannelId);
  const contextMessage=[normalizedMessage,voiceTranscript].filter(Boolean).join('\n\n');
  if(!contextMessage && !nonAudioAttachments.length) return message.reply('Please include the question or guidance.');
  const prompt=buildParentContextPrompt({text:contextMessage});
  return runParentTurn(message,child,prompt,{attachments:nonAudioAttachments});
}

async function statusForChild(child){
  const prompt=buildSlashStatusPrompt({child,memory:''});
  if(tutorClient){
    const result=await tutorClient.turn({learner:child.id,prompt,attachments:[]});
    return formatSlashStatus(child,result.text);
  }
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
    const handler=tutorClient?handleTutorChildMessage:(browserBridge?handleBrowserChildMessage:handleChildMessage);
    serialize(child.id,()=>browserBridge&&!tutorClient?handler(message,child,browserBridge):handler(message,child)).catch(error=>{console.error(`[family-tutor] ${child.id} turn failed`,error); message.reply('The tutor is temporarily unavailable. Please try again shortly.').catch(()=>{});});
    return;
  }
  if(config.discord.parentChannelId && message.channelId===config.discord.parentChannelId){
    const command=parseParentMessage(message.content,config.children);
    const key=command?.channelMentionId||'parent-control';
    serialize(key,()=>handleParentControl(message)).catch(error=>{console.error('[family-tutor] parent control failed',error); message.reply(error.message.includes('configuration error')?error.message:'Parent control is temporarily unavailable.').catch(()=>{});});
  }
});
if(config.browserWorkspace?.enabled){
  tutorClient=new BrowserWorkspaceTutorClient({
    instanceDir,
    workspace:config.browserWorkspace.workspace||'Tutor',
  });
  tutorTransport='browser-workspace';
  const status=await tutorClient.status();
  const bindings=await ensureTutorLearners(status);
  console.log(`[family-tutor-orchestrator] Browser Workspace Tutor ready in ${config.browserWorkspace.workspace||'Tutor'} with ${bindings.length} learner binding(s)`);
}else if(config.neoyTutor?.enabled){
  tutorClient=new NeoYTutorClient({
    url:config.neoyTutor.url||'http://127.0.0.1:6767/mcp',
    instanceDir,
  });
  tutorTransport='legacy-neoy';
  const status=await tutorClient.status();
  const bindings=await ensureTutorLearners(status);
  console.log(`[family-tutor-orchestrator] Legacy NeoY Tutor connected at ${config.neoyTutor.url||'http://127.0.0.1:6767/mcp'} with ${bindings.length} learner binding(s)`);
}
if(tutorClient||config.browserBridge?.enabled){
  browserBridge=new BrowserBridge({
    instanceDir,
    children:config.children,
    host:config.browserBridge?.host||'127.0.0.1',
    port:config.browserBridge?.port||43117,
    token:process.env.FAMILY_TUTOR_BRIDGE_TOKEN?.trim()||null,
    replyToDiscord:async({origin,text})=>{
      const channel=await client.channels.fetch(origin.channelId);
      if(!channel?.isTextBased()) throw new Error('originating Discord channel is unavailable');
      const original=await channel.messages.fetch(origin.messageId);
      await replyToMessage(original,text);
    },
    sendToDiscord:async({channelId,text})=>{
      const channel=await client.channels.fetch(channelId);
      if(!channel?.isTextBased()) throw new Error('Discord channel is unavailable');
      await sendChunks(channel,text);
    },
    requestNewThread:tutorClient?async({childId,reason})=>{
      const child=config.children.find(candidate=>candidate.id===childId);
      if(!child) throw new Error('unknown child');
      await tutorClient.resetThread({
        learner:child.id,
        projectName:child.name||child.id,
        instructions:await tutorProjectInstructions(child),
        initialPrompt:'Start a fresh Family Tutor thread for '+(child.name||child.id)+'. Use the Project Instructions. Reply only with READY.',
      });
      console.log('[family-tutor-orchestrator] Tutor started fresh thread for '+child.id+': '+(reason||'context_long'));
    }:null,
    addChild:addKid,
    deleteChild:deleteKid,
    getSetupStatus:discordSetupStatus,
    finishSetup:sendSetupGreetings,
  });
  await browserBridge.start();
  console.log('[family-tutor-orchestrator] Family Tutor MCP listening on '+browserBridge.endpoint()+(tutorClient?` (${tutorTransport} transport)`:' (legacy browser transport)'));
}
startBootstrapControl();
for(const signal of ['SIGINT','SIGTERM']){
  process.once(signal,async()=>{
    try{ await browserBridge?.stop(); }catch(error){ console.error('[family-tutor] browser bridge shutdown failed',error); }
    try{ bootstrapControlServer?.close(); }catch{}
    client.destroy();
    process.exit(0);
  });
}
await client.login(discordToken);
