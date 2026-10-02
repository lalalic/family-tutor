import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DISCORD_API='https://discord.com/api/v10';
const NEOY_URL=process.env.NEOY_MCP_URL||'https://neoy.qili2.com/mcp';
const TOOL='mcp.family-tutor.ingest_discord_message';
const INTENTS=(1<<0)|(1<<9)|(1<<15);

function loadPm2Token(){
  for(const file of [path.join(os.homedir(),'.pm2','dump.pm2'),path.join(os.homedir(),'.pm2','dump.pm2.bak')]){
    try{
      const list=JSON.parse(fs.readFileSync(file,'utf8'));
      for(const item of list){
        const value=item?.pm2_env?.env?.DISCORD_BOT_TOKEN||item?.pm2_env?.DISCORD_BOT_TOKEN;
        if(value) return String(value).trim();
      }
    }catch{}
  }
  return '';
}
function loadNeoYToken(){
  try{return fs.readFileSync(path.join(os.homedir(),'Library','Application Support','NeoY','core-token'),'utf8').trim();}catch{return '';}
}
const discordToken=String(process.env.DISCORD_BOT_TOKEN||loadPm2Token()).trim();
const neoyToken=String(process.env.NEOY_MCP_TOKEN||loadNeoYToken()).trim();
if(!discordToken) throw new Error('Discord bot credential unavailable');
if(!neoyToken) throw new Error('NeoY MCP credential unavailable');

const log=(event,data={})=>console.log(JSON.stringify({ts:new Date().toISOString(),event,...data}));
async function discord(pathname,init={}){
  const response=await fetch(DISCORD_API+pathname,{...init,headers:{authorization:`Bot ${discordToken}`,'content-type':'application/json',...(init.headers||{})}});
  if(!response.ok) throw new Error(`Discord ${response.status}`);
  return response.status===204?null:response.json();
}
async function react(message){
  const emoji=encodeURIComponent('🤔');
  await discord(`/channels/${message.channel_id}/messages/${message.id}/reactions/${emoji}/@me`,{method:'PUT'});
}
async function contextFor(message){
  const channel=await discord(`/channels/${message.channel_id}`);
  const mentions=[];
  for(const match of String(message.content||'').matchAll(/<#(\d+)>/g)){
    if(mentions.length>=4) break;
    try{const c=await discord(`/channels/${match[1]}`); if(c?.name) mentions.push({id:String(c.id),name:String(c.name)});}catch{}
  }
  return {channelId:String(message.channel_id),channelName:String(channel?.name||''),mentionedChannels:mentions};
}
async function callTutor(message,ctx){
  const attachments=(message.attachments||[]).slice(0,4).map(a=>({url:String(a.url||''),name:String(a.filename||'attachment'),mimeType:String(a.content_type||''),size:Number(a.size||0)}));
  const response=await fetch(NEOY_URL,{method:'POST',headers:{authorization:`Bearer ${neoyToken}`,'content-type':'application/json','user-agent':'Family-Tutor-Discord-Relay/1'},body:JSON.stringify({jsonrpc:'2.0',id:message.id,method:'tools/call',params:{name:TOOL,arguments:{...ctx,messageId:String(message.id),content:String(message.content||''),attachments}}})});
  if(!response.ok) throw new Error(`NeoY ${response.status}`);
  const rpc=await response.json();
  if(rpc.error) throw new Error(rpc.error.message||'NeoY RPC failed');
  if(rpc.result?.isError) throw new Error(rpc.result?.content?.[0]?.text||'Tutor failed');
  const text=rpc.result?.content?.find(x=>x.type==='text')?.text||'{}';
  return JSON.parse(text);
}
async function reply(message,text){
  await discord(`/channels/${message.channel_id}/messages`,{method:'POST',body:JSON.stringify({content:String(text).slice(0,2000),message_reference:{message_id:message.id,fail_if_not_exists:false}})});
}
const seen=new Map();
async function handle(message){
  if(!message?.id||message.author?.bot||seen.has(message.id)) return;
  seen.set(message.id,Date.now());
  for(const [id,at] of seen) if(Date.now()-at>10*60*1000) seen.delete(id);
  const started=Date.now();
  try{
    await react(message);
    log('reacted',{messageId:message.id,ms:Date.now()-started});
    const ctx=await contextFor(message);
    const result=await callTutor(message,ctx);
    if(!result?.ignored&&String(result?.text||'').trim()) await reply(message,result.text);
    log('completed',{messageId:message.id,channelName:ctx.channelName,role:result?.role||null,ms:Date.now()-started});
  }catch(error){log('failed',{messageId:message.id,error:String(error),ms:Date.now()-started});}
}

let ws=null,seq=null,heartbeat=null,sessionId=null,resumeUrl=null,reconnectTimer=null;
function send(payload){if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(payload));}
function reconnect(){if(reconnectTimer)return; reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},1000);}
function connect(){
  clearInterval(heartbeat); heartbeat=null;
  const url=resumeUrl?`${resumeUrl}?v=10&encoding=json`:'wss://gateway.discord.gg/?v=10&encoding=json';
  ws=new WebSocket(url);
  ws.addEventListener('open',()=>log('socket_open',{resume:Boolean(sessionId)}));
  ws.addEventListener('message',event=>{
    let payload; try{payload=JSON.parse(String(event.data||'{}'));}catch{return;}
    if(payload.s!==null&&payload.s!==undefined) seq=payload.s;
    if(payload.op===10){
      heartbeat=setInterval(()=>send({op:1,d:seq}),Number(payload.d?.heartbeat_interval||45000));
      if(sessionId&&resumeUrl) send({op:6,d:{token:discordToken,session_id:sessionId,seq}});
      else send({op:2,d:{token:discordToken,intents:INTENTS,properties:{os:'darwin',browser:'family-tutor-relay',device:'family-tutor-relay'}}});
      return;
    }
    if(payload.op===7){try{ws.close()}catch{};return;}
    if(payload.op===9){sessionId=null;resumeUrl=null;seq=null;try{ws.close()}catch{};return;}
    if(payload.op!==0) return;
    if(payload.t==='READY'){sessionId=payload.d?.session_id||null;resumeUrl=payload.d?.resume_gateway_url||null;log('ready');return;}
    if(payload.t==='RESUMED'){log('resumed');return;}
    if(payload.t==='MESSAGE_CREATE') handle(payload.d);
  });
  ws.addEventListener('close',event=>{clearInterval(heartbeat);heartbeat=null;ws=null;log('socket_close',{code:event.code});reconnect();});
  ws.addEventListener('error',()=>{try{ws.close()}catch{}});
}
connect();
