const DISCORD_API='https://discord.com/api/v10';
const GATEWAY_URL='wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS=(1<<0)|(1<<9)|(1<<15); // GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT

export function normalizeDiscordAttachment(value={}){
  return {
    url:String(value.url||''),
    name:String(value.filename||value.name||'attachment'),
    mimeType:String(value.content_type||value.mimeType||''),
    size:Number(value.size||0),
  };
}

export async function discordApi(env,path,init={}){
  const response=await fetch(`${DISCORD_API}${path}`,{
    ...init,
    headers:{authorization:`Bot ${env.DISCORD_BOT_TOKEN}`,'content-type':'application/json',...(init.headers||{})},
  });
  if(!response.ok) throw new Error(`Discord API ${response.status}`);
  return response.status===204?null:response.json();
}

export async function callNeoYTutor(env,{channelName,messageId,content,attachments}){
  if(!env.NEOY_MCP_URL||!env.NEOY_MCP_TOKEN) throw new Error('NeoY MCP endpoint is not configured');
  const response=await fetch(env.NEOY_MCP_URL,{
    method:'POST',
    headers:{authorization:`Bearer ${env.NEOY_MCP_TOKEN}`,'content-type':'application/json','user-agent':'Cloudflare-Worker/Family-Tutor'},
    body:JSON.stringify({
      jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{
        name:env.FAMILY_TUTOR_MCP_TOOL||'mcp.family-tutor.ingest_discord_message',
        arguments:{channelName,messageId,content,attachments},
      },
    }),
  });
  if(!response.ok) throw new Error(`NeoY MCP ${response.status}`);
  const rpc=await response.json();
  if(rpc.error) throw new Error(rpc.error.message||'NeoY MCP call failed');
  const result=rpc.result||{};
  if(result.isError) throw new Error(result.content?.[0]?.text||'Family Tutor returned an error');
  const text=result.content?.find(item=>item.type==='text')?.text||'{}';
  return JSON.parse(text);
}

export async function handleDiscordMessage(env,message){
  if(!message||message.author?.bot||!message.channel_id||!message.id) return {ignored:true};
  const channel=await discordApi(env,`/channels/${encodeURIComponent(message.channel_id)}`);
  if(!channel?.name) return {ignored:true,reason:'channel_name_unavailable'};
  const tutor=await callNeoYTutor(env,{
    channelName:channel.name,
    messageId:message.id,
    content:String(message.content||''),
    attachments:(message.attachments||[]).map(normalizeDiscordAttachment),
  });
  if(tutor?.ignored||!String(tutor?.text||'').trim()) return tutor||{ignored:true};
  await discordApi(env,`/channels/${encodeURIComponent(message.channel_id)}/messages`,{
    method:'POST',
    body:JSON.stringify({content:String(tutor.text).slice(0,2000),message_reference:{message_id:message.id,fail_if_not_exists:false}}),
  });
  return tutor;
}

export class DiscordGateway {
  constructor(state,env){
    this.state=state; this.env=env; this.ws=null; this.seq=null; this.sessionId=null; this.resumeUrl=null; this.heartbeat=null;
  }
  async fetch(request){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/start'){
      await this.ensureConnected();
      return Response.json({ok:true,connected:this.ws?.readyState===WebSocket.OPEN});
    }
    if(request.method==='GET'&&url.pathname==='/status'){
      return Response.json({ok:true,connected:this.ws?.readyState===WebSocket.OPEN,sessionId:Boolean(this.sessionId),seq:this.seq});
    }
    return new Response('not found',{status:404});
  }
  async alarm(){ await this.ensureConnected(true); await this.state.storage.setAlarm(Date.now()+10*60*1000); }
  async ensureConnected(force=false){
    if(!this.sessionId){
      const saved=await this.state.storage.get('gateway');
      if(saved){ this.sessionId=saved.sessionId||null; this.resumeUrl=saved.resumeUrl||null; this.seq=saved.seq??null; }
    }
    if(!force&&this.ws&&(this.ws.readyState===WebSocket.OPEN||this.ws.readyState===WebSocket.CONNECTING)) return;
    if(this.ws) try{this.ws.close();}catch{}
    clearInterval(this.heartbeat);
    const url=this.resumeUrl?`${this.resumeUrl}?v=10&encoding=json`:GATEWAY_URL;
    const ws=new WebSocket(url); this.ws=ws;
    ws.addEventListener('message',event=>this.state.waitUntil(this.onMessage(event).catch(error=>console.error('discord gateway message failed',error))));
    ws.addEventListener('close',()=>{clearInterval(this.heartbeat); this.heartbeat=null; this.ws=null; this.state.waitUntil(this.state.storage.setAlarm(Date.now()+1000));});
    ws.addEventListener('error',()=>{try{ws.close();}catch{}});
    await this.state.storage.setAlarm(Date.now()+10*60*1000);
  }
  send(payload){ if(this.ws?.readyState===WebSocket.OPEN) this.ws.send(JSON.stringify(payload)); }
  async onMessage(event){
    const payload=JSON.parse(String(event.data||'{}'));
    if(payload.s!==null&&payload.s!==undefined){
      this.seq=payload.s;
      if(this.sessionId) await this.state.storage.put('gateway',{sessionId:this.sessionId,resumeUrl:this.resumeUrl,seq:this.seq});
    }
    if(payload.op===10){
      const interval=Number(payload.d?.heartbeat_interval||45000);
      clearInterval(this.heartbeat);
      this.heartbeat=setInterval(()=>this.send({op:1,d:this.seq}),interval);
      if(this.sessionId&&this.resumeUrl) this.send({op:6,d:{token:this.env.DISCORD_BOT_TOKEN,session_id:this.sessionId,seq:this.seq}});
      else this.send({op:2,d:{token:this.env.DISCORD_BOT_TOKEN,intents:INTENTS,properties:{os:'cloudflare',browser:'family-tutor',device:'family-tutor'}}});
      return;
    }
    if(payload.op===7){ await this.ensureConnected(true); return; }
    if(payload.op===9){ this.sessionId=null; this.resumeUrl=null; this.seq=null; await this.ensureConnected(true); return; }
    if(payload.op!==0) return;
    if(payload.t==='READY'){
      this.sessionId=payload.d?.session_id||null;
      this.resumeUrl=payload.d?.resume_gateway_url||null;
      await this.state.storage.put('gateway',{sessionId:this.sessionId,resumeUrl:this.resumeUrl,seq:this.seq});
      return;
    }
    if(payload.t==='MESSAGE_CREATE') await handleDiscordMessage(this.env,payload.d);
  }
}
