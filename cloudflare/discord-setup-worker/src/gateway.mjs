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

export async function callNeoYTutor(env,{channelId,channelName,messageId,content,attachments,mentionedChannels=[]}){
  if(!env.NEOY_MCP_URL||!env.NEOY_MCP_TOKEN) throw new Error('NeoY MCP endpoint is not configured');
  const response=await fetch(env.NEOY_MCP_URL,{
    method:'POST',
    headers:{authorization:`Bearer ${env.NEOY_MCP_TOKEN}`,'content-type':'application/json','user-agent':'Cloudflare-Worker/Family-Tutor'},
    body:JSON.stringify({
      jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{
        name:env.FAMILY_TUTOR_MCP_TOOL||'mcp.family-tutor.ingest_discord_message',
        arguments:{channelId,channelName,messageId,content,attachments,mentionedChannels},
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

export async function reactToDiscordMessage(env,channelId,messageId,emoji='🤔'){
  const encoded=encodeURIComponent(emoji);
  return discordApi(env,`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encoded}/@me`,{method:'PUT'});
}

export function discordSnowflakeTimestamp(id){
  try{return Number((BigInt(String(id))>>22n)+1420070400000n);}catch{return 0;}
}

export async function handleDiscordMessage(env,message,{reactFirst=true}={}){
  if(!message||message.author?.bot||!message.channel_id||!message.id) return {ignored:true};
  const channel=await discordApi(env,`/channels/${encodeURIComponent(message.channel_id)}`);
  if(!channel?.name) return {ignored:true,reason:'channel_name_unavailable'};
  if(reactFirst) await reactToDiscordMessage(env,message.channel_id,message.id).catch(error=>console.warn('discord reaction failed',error));
  console.log('discord message received',{channelName:channel.name,messageId:message.id});
  const content=String(message.content||'');
  const mentionIds=[...content.matchAll(/<#(\d+)>/g)].map(match=>match[1]);
  const mentionedChannels=[];
  for(const id of mentionIds.slice(0,4)){
    try{
      const mentioned=await discordApi(env,`/channels/${encodeURIComponent(id)}`);
      if(mentioned?.name) mentionedChannels.push({id:String(mentioned.id||id),name:String(mentioned.name)});
    }catch{}
  }
  const tutor=await callNeoYTutor(env,{
    channelId:String(message.channel_id),
    channelName:channel.name,
    messageId:message.id,
    content,
    attachments:(message.attachments||[]).map(normalizeDiscordAttachment),
    mentionedChannels,
  });
  if(tutor?.ignored||!String(tutor?.text||'').trim()) return tutor||{ignored:true};
  if(!reactFirst) await reactToDiscordMessage(env,message.channel_id,message.id).catch(error=>console.warn('discord catch-up reaction failed',error));
  console.log('family tutor replied',{channelName:channel.name,messageId:message.id,ignored:Boolean(tutor?.ignored)});
  await discordApi(env,`/channels/${encodeURIComponent(message.channel_id)}/messages`,{
    method:'POST',
    body:JSON.stringify({content:String(tutor.text).slice(0,2000),message_reference:{message_id:message.id,fail_if_not_exists:false}}),
  });
  return tutor;
}

export class DiscordGateway {
  constructor(state,env){
    this.state=state; this.env=env; this.ws=null; this.seq=null; this.sessionId=null; this.resumeUrl=null; this.heartbeat=null; this.lastEvent=null; this.lastError=null; this.catchUpRunning=false; this.lastCatchUpAt=0;
  }
  async fetch(request){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/start'){
      await this.ensureConnected();
      if(this.sessionId) this.state.waitUntil(this.catchUpRecent());
      return Response.json({ok:true,connected:this.ws?.readyState===WebSocket.OPEN,ready:Boolean(this.sessionId),sessionId:Boolean(this.sessionId),seq:this.seq,lastEvent:this.lastEvent,lastError:this.lastError,lastCatchUpAt:this.lastCatchUpAt||null,catchUpRunning:this.catchUpRunning});
    }
    if(request.method==='POST'&&url.pathname==='/relay'){
      const body=await request.json().catch(()=>null);
      if(!body?.id) return Response.json({ok:false,error:'invalid_message'},{status:400});
      const result=await this.processMessage(body,{reactFirst:true});
      return Response.json({ok:true,result,lastEvent:this.lastEvent,lastError:this.lastError});
    }
    if(request.method==='POST'&&url.pathname==='/poll'){
      const body=await request.json().catch(()=>({}));
      const recovered=await this.catchUpRecent({windowMs:Number(body.windowMs||30*60*1000),force:Boolean(body.force)});
      return Response.json({ok:true,recovered,lastEvent:this.lastEvent,lastError:this.lastError,lastCatchUpAt:this.lastCatchUpAt||null});
    }
    if(request.method==='GET'&&url.pathname==='/status'){
      return Response.json({ok:true,connected:this.ws?.readyState===WebSocket.OPEN,ready:Boolean(this.sessionId),sessionId:Boolean(this.sessionId),seq:this.seq,lastEvent:this.lastEvent,lastError:this.lastError,lastCatchUpAt:this.lastCatchUpAt||null,catchUpRunning:this.catchUpRunning});
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
  async processMessage(message,{reactFirst=true}={}){
    if(!message?.id) return {ignored:true};
    const key=`message:${message.id}`;
    if(await this.state.storage.get(key)) return {ignored:true,reason:'duplicate'};
    const result=await handleDiscordMessage(this.env,message,{reactFirst});
    await this.state.storage.put(key,{at:new Date().toISOString(),channelId:message.channel_id,ignored:Boolean(result?.ignored),reason:result?.reason||null});
    if(!result?.ignored){
      this.lastError=null;
      this.lastEvent={type:'MESSAGE_PROCESSED',channelId:message.channel_id,messageId:message.id,at:new Date().toISOString()};
    }
    return result;
  }
  async catchUpRecent({windowMs=30*60*1000,force=false}={}){
    const now=Date.now();
    if(this.catchUpRunning) return 0;
    if(!force && this.lastCatchUpAt && now-this.lastCatchUpAt<60000) return 0;
    this.catchUpRunning=true;
    const cutoff=now-windowMs;
    let recovered=0;
    try{
      const guilds=await discordApi(this.env,'/users/@me/guilds');
    for(const guild of guilds||[]){
      const channels=await discordApi(this.env,`/guilds/${encodeURIComponent(guild.id)}/channels`);
      for(const channel of channels||[]){
        if(channel.type!==0) continue;
        let messages=[];
        try{messages=await discordApi(this.env,`/channels/${encodeURIComponent(channel.id)}/messages?limit=10`);}catch{continue;}
        const rows=messages||[];
        const replied=new Set(rows.filter(message=>message.author?.bot&&message.message_reference?.message_id).map(message=>String(message.message_reference.message_id)));
        const recent=rows.filter(message=>{
          if(message.author?.bot||discordSnowflakeTimestamp(message.id)<cutoff||replied.has(String(message.id))) return false;
          const relayReaction=(message.reactions||[]).some(reaction=>reaction?.me&&reaction?.emoji?.name==='🤔');
          const age=Date.now()-discordSnowflakeTimestamp(message.id);
          if(relayReaction&&age<2*60*1000) return false;
          return true;
        }).sort((a,b)=>discordSnowflakeTimestamp(a.id)-discordSnowflakeTimestamp(b.id));
        for(const message of recent){
          try{
            const result=await this.processMessage(message,{reactFirst:false});
            if(!result?.ignored) recovered+=1;
          }catch(error){
            this.lastError=String(error?.stack||error);
            console.error('discord catch-up failed',error);
          }
        }
      }
    }
      this.lastCatchUpAt=Date.now();
      console.log('discord catch-up complete',{recovered});
      return recovered;
    }finally{
      this.catchUpRunning=false;
    }
  }
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
    this.lastEvent={type:payload.t||null,at:new Date().toISOString()};
    if(payload.t==='READY'){
      this.sessionId=payload.d?.session_id||null;
      this.resumeUrl=payload.d?.resume_gateway_url||null;
      await this.state.storage.put('gateway',{sessionId:this.sessionId,resumeUrl:this.resumeUrl,seq:this.seq});
      this.state.waitUntil(this.catchUpRecent());
      return;
    }
    if(payload.t==='MESSAGE_CREATE'){
      try{ await this.processMessage(payload.d,{reactFirst:true}); }
      catch(error){ this.lastError=String(error?.stack||error); console.error('discord message handling failed',error); }
    }
  }
}
