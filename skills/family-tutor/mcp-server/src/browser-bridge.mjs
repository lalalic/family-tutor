import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const MAX_IMAGE_BYTES=12*1024*1024;
const MAX_IMAGES=4;
const DEFAULT_TTL_MS=15*60*1000;
const FAMILY_TUTOR_EXTENSION_ORIGIN=process.env.FAMILY_TUTOR_EXTENSION_ORIGIN||'chrome-extension://cbhalklofapefdghfgdglmdfkeohdegm';

function safeName(name='image'){
  return path.basename(String(name)).replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,120)||'image';
}
function isImage(a){
  const type=String(a?.mimeType||a?.contentType||'').toLowerCase();
  return type.startsWith('image/')||/\.(png|jpe?g|webp|gif|heic|heif)$/i.test(a?.name||'');
}
async function readJson(req,maxBytes=256*1024){
  const chunks=[]; let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
}
function json(res,status,body,headers={}){
  const data=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'content-type':'application/json','content-length':String(data.length),'cache-control':'no-store',...headers});
  res.end(data);
}
async function readForm(req,maxBytes=64*1024){
  const chunks=[]; let size=0;
  for await(const chunk of req){ size+=chunk.length; if(size>maxBytes) throw new Error('request body too large'); chunks.push(chunk); }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
function b64url(value){return Buffer.from(value).toString('base64url');}
function timingSafeEqualText(a,b){
  const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function textResult(value,isError=false){
  return {content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],...(isError?{isError:true}:{})};
}
function contextWithCorrelation(prompt,correlationId){
  const match=String(prompt||'').match(/^<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>$/);
  if(!match) throw new Error('browser turns require a typed runtime context envelope');
  let envelope;
  try{ envelope=JSON.parse(match[1]); }catch{ throw new Error('browser runtime context is not valid JSON'); }
  if(!envelope||!['kid','parent'].includes(envelope.type)||!envelope.data||typeof envelope.data!=='object'||Array.isArray(envelope.data)) throw new Error('browser runtime context is invalid');
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({type:envelope.type,data:{...envelope.data,correlationId}})}\n</FAMILY_TUTOR_CONTEXT>`;
}

export class BrowserBridge {
  constructor({instanceDir,children=[],host='127.0.0.1',port=8787,token=null,blobDir=null,fetchImpl=fetch,replyToDiscord=null,addChild=null,deleteChild=null,ttlMs=DEFAULT_TTL_MS,turnTimeoutMs=DEFAULT_TTL_MS}){
    this.instanceDir=instanceDir;
    this.root=path.join(instanceDir,'.browser-bridge');
    this.blobRoot=blobDir||path.join(this.root,'blobs');
    this.tokenFile=path.join(this.root,'token');
    this.children=new Map(children.map(child=>[child.id,{id:child.id,name:child.name||child.id}]));
    this.host=host;
    this.port=Number(port);
    this.fetchImpl=fetchImpl;
    this.replyToDiscord=replyToDiscord;
    this.addChild=addChild;
    this.deleteChild=deleteChild;
    this.ttlMs=ttlMs;
    this.turnTimeoutMs=turnTimeoutMs;
    this.configuredToken=token;
    this.queues=new Map();
    this.inFlight=new Map();
    this.correlations=new Map();
    this.childSockets=new Map();
    this.childVersions=new Map();
    this.server=null;
    this.wsServer=null;
    this.token=null;
    this.cleanupTimer=null;
    this.lastExtensionError=null;
    this.publicOrigin=String(process.env.FAMILY_TUTOR_PUBLIC_ORIGIN||'https://family-tutor.qili2.com').replace(/\/$/,'');
    this.oauthClientId=process.env.FAMILY_TUTOR_OAUTH_CLIENT_ID||'family-tutor-chatgpt';
    this.extensionOAuthClientId='family-tutor-extension';
    this.extensionRedirectHost='cbhalklofapefdghfgdglmdfkeohdegm.chromiumapp.org';
    this.oauthClientSecretFile=path.join(this.root,'oauth-client-secret');
    this.oauthClientSecret=null;
    this.oauthCodes=new Map();
  }

  async start(){
    await fsp.mkdir(this.blobRoot,{recursive:true,mode:0o700});
    this.token=this.configuredToken||await this.#loadOrCreateToken();
    if(this.token.length<24) throw new Error('browser bridge token must be at least 24 characters');
    this.oauthClientSecret=await this.#loadOrCreateOAuthClientSecret();
    this.server=http.createServer((req,res)=>this.#handle(req,res).catch(error=>{
      console.error('[family-tutor] browser bridge request failed',error);
      if(!res.headersSent) json(res,500,{error:'bridge request failed'});
      else res.end();
    }));
    this.wsServer=new WebSocketServer({noServer:true});
    this.server.on('upgrade',(req,socket,head)=>this.#upgrade(req,socket,head));
    this.wsServer.on('connection',(socket,req)=>this.#connection(socket,req));
    await new Promise((resolve,reject)=>{
      this.server.once('error',reject);
      this.server.listen(this.port,this.host,resolve);
    });
    this.port=this.server.address().port;
    this.cleanupTimer=setInterval(()=>this.cleanupExpired().catch(()=>{}),60_000);
    this.cleanupTimer.unref?.();
    return this;
  }

  async close(){
    if(this.cleanupTimer) clearInterval(this.cleanupTimer);
    for(const socket of this.wsServer?.clients||[]) socket.close();
    if(this.wsServer) await new Promise(resolve=>this.wsServer.close(resolve));
    if(this.server) await new Promise(resolve=>this.server.close(resolve));
    this.wsServer=null;
    this.server=null;
  }

  async stop(){ return this.close(); }

  async #loadOrCreateToken(){
    try{return (await fsp.readFile(this.tokenFile,'utf8')).trim();}
    catch{
      const token=crypto.randomBytes(32).toString('base64url');
      await fsp.writeFile(this.tokenFile,token+'\n',{mode:0o600});
      return token;
    }
  }

  async #loadOrCreateOAuthClientSecret(){
    try{return (await fsp.readFile(this.oauthClientSecretFile,'utf8')).trim();}
    catch{
      const secret=crypto.randomBytes(32).toString('base64url');
      await fsp.writeFile(this.oauthClientSecretFile,secret+'\n',{mode:0o600});
      return secret;
    }
  }

  #oauthResource(){return `${this.publicOrigin}/mcp`;}
  #extensionResource(){return `${this.publicOrigin}/ws`;}
  #oauthMetadataUrl(){return `${this.publicOrigin}/.well-known/oauth-protected-resource`;}
  #oauthChallenge(error='invalid_token',description='Authentication required'){
    return `Bearer resource_metadata=\"${this.#oauthMetadataUrl()}\", scope=\"tutor\", error=\"${error}\", error_description=\"${description.replace(/[\"\r\n]/g,' ')}\"`;
  }
  #validRedirect(uri,clientId=this.oauthClientId){
    try{
      const url=new URL(uri);
      if(clientId===this.oauthClientId) return url.protocol==='https:'&&url.hostname==='chatgpt.com'&&(url.pathname.startsWith('/connector/oauth/')||url.pathname==='/connector_platform_oauth_redirect');
      if(clientId===this.extensionOAuthClientId) return url.protocol==='https:'&&url.hostname===this.extensionRedirectHost&&url.pathname.startsWith('/family-tutor');
      return false;
    }catch{return false;}
  }
  #signAccessToken({scope='tutor',resource=this.#oauthResource(),clientId=this.oauthClientId,expiresIn=3600}={}){
    const payload=b64url(JSON.stringify({iss:this.publicOrigin,aud:resource,client_id:clientId,scope,exp:Math.floor(Date.now()/1000)+expiresIn}));
    const signature=crypto.createHmac('sha256',this.token).update(`ft1.${payload}`).digest('base64url');
    return `ft1.${payload}.${signature}`;
  }
  #verifyScopedAccessToken(token,{resource,clientId,scope}){
    const parts=String(token||'').split('.');
    if(parts.length!==3||parts[0]!=='ft1') return false;
    const expected=crypto.createHmac('sha256',this.token).update(`ft1.${parts[1]}`).digest('base64url');
    if(!timingSafeEqualText(parts[2],expected)) return false;
    try{
      const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
      return payload.iss===this.publicOrigin&&payload.aud===resource&&payload.client_id===clientId&&String(payload.scope||'').split(/\s+/).includes(scope)&&Number(payload.exp)>Math.floor(Date.now()/1000);
    }catch{return false;}
  }
  #verifyAccessToken(token){return this.#verifyScopedAccessToken(token,{resource:this.#oauthResource(),clientId:this.oauthClientId,scope:'tutor'});}
  #verifyExtensionAccessToken(token){return this.#verifyScopedAccessToken(token,{resource:this.#extensionResource(),clientId:this.extensionOAuthClientId,scope:'extension'});}
  #signExtensionRefreshToken(expiresIn=180*24*60*60){
    const payload=b64url(JSON.stringify({iss:this.publicOrigin,client_id:this.extensionOAuthClientId,scope:'extension_refresh',exp:Math.floor(Date.now()/1000)+expiresIn}));
    const signature=crypto.createHmac('sha256',this.token).update(`ftr1.${payload}`).digest('base64url');
    return `ftr1.${payload}.${signature}`;
  }
  #verifyExtensionRefreshToken(token){
    const parts=String(token||'').split('.');
    if(parts.length!==3||parts[0]!=='ftr1') return false;
    const expected=crypto.createHmac('sha256',this.token).update(`ftr1.${parts[1]}`).digest('base64url');
    if(!timingSafeEqualText(parts[2],expected)) return false;
    try{
      const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
      return payload.iss===this.publicOrigin&&payload.client_id===this.extensionOAuthClientId&&payload.scope==='extension_refresh'&&Number(payload.exp)>Math.floor(Date.now()/1000);
    }catch{return false;}
  }
  #mcpAuthorized(req){
    const value=String(req.headers.authorization||'');
    if(value===`Bearer ${this.token}`) return true;
    const match=value.match(/^Bearer\s+(\S+)$/i);
    return Boolean(match&&this.#verifyAccessToken(match[1]));
  }
  #oauthClientCredentials(req,form){
    const header=String(req.headers.authorization||'');
    if(/^Basic\s+/i.test(header)){
      try{const raw=Buffer.from(header.replace(/^Basic\s+/i,''),'base64').toString('utf8');const split=raw.indexOf(':');return {id:decodeURIComponent(raw.slice(0,split)),secret:decodeURIComponent(raw.slice(split+1))};}
      catch{return {id:'',secret:''};}
    }
    return {id:form.get('client_id')||'',secret:form.get('client_secret')||''};
  }
  #oauthClientValid(id,secret){
    if(id===this.oauthClientId) return timingSafeEqualText(secret,this.oauthClientSecret);
    if(id===this.extensionOAuthClientId) return !secret;
    return false;
  }
  #oauthAuthorize(url,res){
    const responseType=url.searchParams.get('response_type');
    const clientId=url.searchParams.get('client_id');
    const redirectUri=url.searchParams.get('redirect_uri');
    const state=url.searchParams.get('state')||'';
    const isChatGpt=clientId===this.oauthClientId;
    const isExtension=clientId===this.extensionOAuthClientId;
    const expectedResource=isExtension?this.#extensionResource():this.#oauthResource();
    const expectedScope=isExtension?'extension':'tutor';
    const resource=url.searchParams.get('resource')||expectedResource;
    const scope=url.searchParams.get('scope')||expectedScope;
    const challenge=url.searchParams.get('code_challenge');
    const challengeMethod=url.searchParams.get('code_challenge_method');
    const invalid = responseType!=='code' ? 'response_type'
      : (!isChatGpt&&!isExtension) ? 'client_id'
      : !this.#validRedirect(redirectUri,clientId) ? 'redirect_uri'
      : resource!==expectedResource ? 'resource'
      : !scope.split(/\s+/).includes(expectedScope) ? 'scope'
      : challengeMethod!=='S256'||!challenge ? 'pkce'
      : null;
    if(invalid) return json(res,400,{error:'invalid_request',error_description:`Invalid OAuth ${invalid}.`});
    const code=crypto.randomBytes(32).toString('base64url');
    this.oauthCodes.set(code,{clientId,redirectUri,resource,scope,challenge,expiresAt:Date.now()+5*60*1000});
    const target=new URL(redirectUri); target.searchParams.set('code',code); if(state) target.searchParams.set('state',state); if(url.searchParams.get('iss')!==null) target.searchParams.set('iss',this.publicOrigin);
    res.writeHead(302,{location:target.toString(),'cache-control':'no-store'});res.end();
  }
  async #oauthToken(req,res){
    const form=await readForm(req);
    const credentials=this.#oauthClientCredentials(req,form);
    if(!this.#oauthClientValid(credentials.id,credentials.secret)) return json(res,401,{error:'invalid_client'});
    const grantType=form.get('grant_type');
    if(grantType==='refresh_token'){
      if(credentials.id!==this.extensionOAuthClientId||!this.#verifyExtensionRefreshToken(form.get('refresh_token'))) return json(res,400,{error:'invalid_grant'});
      return json(res,200,{access_token:this.#signAccessToken({scope:'extension',resource:this.#extensionResource(),clientId:this.extensionOAuthClientId}),token_type:'Bearer',expires_in:3600,scope:'extension'});
    }
    if(grantType!=='authorization_code') return json(res,400,{error:'unsupported_grant_type'});
    const code=form.get('code')||''; const record=this.oauthCodes.get(code); this.oauthCodes.delete(code);
    if(!record||record.expiresAt<Date.now()||record.clientId!==credentials.id||record.redirectUri!==form.get('redirect_uri')) return json(res,400,{error:'invalid_grant'});
    const verifier=form.get('code_verifier')||'';
    const derived=crypto.createHash('sha256').update(verifier).digest('base64url');
    if(!verifier||!timingSafeEqualText(derived,record.challenge)) return json(res,400,{error:'invalid_grant'});
    const resource=form.get('resource')||record.resource; if(resource!==record.resource) return json(res,400,{error:'invalid_target'});
    const response={access_token:this.#signAccessToken({scope:record.scope,resource:record.resource,clientId:record.clientId}),token_type:'Bearer',expires_in:3600,scope:record.scope};
    if(record.clientId===this.extensionOAuthClientId) response.refresh_token=this.#signExtensionRefreshToken();
    return json(res,200,response);
  }

  endpoint(){return `http://${this.host}:${this.port}`;}
  websocketEndpoint(){return `ws://${this.host}:${this.port}/ws`;}

  async enqueue({childId,text='',attachments=[],origin,reply=null}){
    if(!this.children.has(childId)) throw new Error('unknown child');
    const correlationId=crypto.randomUUID();
    const expiresAt=Date.now()+this.ttlMs;
    const imageInputs=attachments.filter(isImage).slice(0,MAX_IMAGES);
    const blobDir=path.join(this.blobRoot,correlationId);
    const files=[];
    if(imageInputs.length) await fsp.mkdir(blobDir,{recursive:true,mode:0o700});
    try{
      for(let i=0;i<imageInputs.length;i++){
        const input=imageInputs[i];
        if(Number(input.size||0)>MAX_IMAGE_BYTES) throw new Error(`${input.name||'image'} exceeds 12 MB`);
        const response=await this.fetchImpl(input.url,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30_000)});
        if(!response.ok) throw new Error(`attachment download failed (${response.status})`);
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>MAX_IMAGE_BYTES) throw new Error(`${input.name||'image'} exceeds 12 MB`);
        const name=`${i+1}-${safeName(input.name)}`;
        await fsp.writeFile(path.join(blobDir,name),bytes,{mode:0o600});
        files.push({name,mimeType:input.mimeType||input.contentType||'application/octet-stream',size:bytes.length,url:`${this.endpoint()}/v1/blobs/${correlationId}/${encodeURIComponent(name)}`});
      }
    }catch(error){
      await fsp.rm(blobDir,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
    const turn={correlationId,childId,text,attachments:files,origin:{channelId:origin.channelId,messageId:origin.messageId,threadId:origin.threadId||null},createdAt:new Date().toISOString()};
    this.correlations.set(correlationId,{childId,origin:turn.origin,blobDir,expiresAt,reply,resolve:null,reject:null,timer:null});
    const queue=this.queues.get(childId)||[];
    queue.push(turn);
    this.queues.set(childId,queue);
    this.#dispatch(childId);
    return turn;
  }

  async turn({childId,prompt,attachments=[],origin,reply}){
    const turn=await this.enqueue({childId,text:prompt,attachments,origin,reply});
    const state=this.correlations.get(turn.correlationId);
    return new Promise((resolve,reject)=>{
      state.resolve=resolve; state.reject=reject;
      state.timer=setTimeout(()=>this.fail(turn.correlationId,new Error('browser turn timed out')).catch(()=>{}),this.turnTimeoutMs);
      state.timer.unref?.();
    });
  }

  next(childId){
    if(!this.children.has(childId)) throw new Error('unknown child');
    if(this.inFlight.has(childId)) return null;
    const queue=this.queues.get(childId)||[];
    const turn=queue.shift()||null;
    if(turn){
      if(queue.length) this.queues.set(childId,queue); else this.queues.delete(childId);
      this.inFlight.set(childId,turn.correlationId);
    }
    return turn;
  }

  async fail(correlationId,error=new Error('browser turn failed')){
    const state=this.correlations.get(correlationId);
    if(!state) return false;
    if(this.inFlight.get(state.childId)===correlationId) this.inFlight.delete(state.childId);
    if(state.timer) clearTimeout(state.timer);
    state.reject?.(error);
    await this.#deleteCorrelation(correlationId,state);
    this.#dispatch(state.childId);
    return true;
  }

  async reply(correlationId,text,{final=true}={}){
    const state=this.correlations.get(correlationId);
    if(!state) throw new Error('unknown or expired correlation');
    if(this.inFlight.get(state.childId)!==correlationId) throw new Error('correlation is not active for child');
    const clean=String(text||'').trim();
    if(!clean) throw new Error('reply text is required');
    if(state.reply) await state.reply(clean);
    else if(this.replyToDiscord) await this.replyToDiscord({correlationId,childId:state.childId,origin:state.origin,text:clean});
    else throw new Error('no Discord reply handler');
    if(!final) return {ok:true,childId:state.childId,correlationId,final:false};
    if(state.timer) clearTimeout(state.timer);
    state.resolve?.({ok:true,childId:state.childId});
    this.inFlight.delete(state.childId);
    await this.#deleteCorrelation(correlationId,state);
    this.#dispatch(state.childId);
    return {ok:true,childId:state.childId,correlationId,final:true};
  }

  async #deleteCorrelation(id,state=this.correlations.get(id)){
    this.correlations.delete(id);
    if(state?.blobDir) await fsp.rm(state.blobDir,{recursive:true,force:true}).catch(()=>{});
  }

  async cleanupExpired(now=Date.now()){
    for(const [id,state] of this.correlations){
      if(state.expiresAt>now) continue;
      if(this.inFlight.get(state.childId)===id) this.inFlight.delete(state.childId);
      if(state.timer) clearTimeout(state.timer);
      state.reject?.(new Error('browser correlation expired'));
      await this.#deleteCorrelation(id,state);
      this.#dispatch(state.childId);
    }
  }

  #extensionPayload(turn){
    return {
      type:'turn',
      childId:turn.childId,
      prompt:contextWithCorrelation(turn.text,turn.correlationId),
      correlation:{correlationId:turn.correlationId},
      attachments:turn.attachments.map(file=>({...file,token:this.token})),
    };
  }

  #dispatch(childId){
    if(this.inFlight.has(childId)) return;
    const socket=this.childSockets.get(childId);
    if(!socket||socket.readyState!==WebSocket.OPEN) return;
    const queue=this.queues.get(childId)||[];
    const turn=queue.shift();
    if(!turn) return;
    if(queue.length) this.queues.set(childId,queue); else this.queues.delete(childId);
    this.inFlight.set(childId,turn.correlationId);
    socket.send(JSON.stringify(this.#extensionPayload(turn)));
  }

  #upgrade(req,socket,head){
    let url;
    try{ url=new URL(req.url,`http://${req.headers.host||'localhost'}`); }catch{ socket.destroy(); return; }
    const extensionAuth=String(req.headers.origin||'')===FAMILY_TUTOR_EXTENSION_ORIGIN;
    const tokenAuth=!process.env.FAMILY_TUTOR_EXTENSION_ORIGIN&&url.searchParams.get('token')===this.token;
    if(url.pathname!=='/ws'||(!extensionAuth&&!tokenAuth)){ socket.destroy(); return; }
    this.wsServer.handleUpgrade(req,socket,head,client=>this.wsServer.emit('connection',client,req));
  }

  #broadcastChildren(){
    const payload=JSON.stringify({type:'bridge.ready',children:[...this.children.values()].sort((a,b)=>a.name.localeCompare(b.name))});
    for(const client of this.wsServer?.clients||[]) if(client.readyState===WebSocket.OPEN) client.send(payload);
  }

  #connection(socket,req){
    const bindings=new Set();
    const host=String(req?.headers?.host||'').split(':')[0].toLowerCase();
    const hosted=host==='family-tutor.qili2.com';
    let authenticated=!hosted;
    if(hosted) socket.send(JSON.stringify({type:'bridge.auth.required'}));
    else socket.send(JSON.stringify({type:'bridge.ready',children:[...this.children.values()].sort((a,b)=>a.name.localeCompare(b.name))}));
    socket.on('message',raw=>{
      let message;
      try{ message=JSON.parse(raw.toString()); }catch{ return; }
      if(!authenticated){
        if(message?.type==='bridge.auth'&&(this.#verifyExtensionAccessToken(message.token)||timingSafeEqualText(message.token,this.token))){
          authenticated=true;
          socket.send(JSON.stringify({type:'bridge.ready',children:[...this.children.values()].sort((a,b)=>a.name.localeCompare(b.name))}));
          return;
        }
        socket.close(4401,'authentication required');
        return;
      }
      if(message?.type==='kid.add'){
        const name=String(message.name||'').trim();
        if(!name){ socket.send(JSON.stringify({type:'kid.result',requestId:message.requestId,ok:false,error:'Kid name is required.'})); return; }
        Promise.resolve(this.addChild?.({name})).then(child=>{
          if(!child?.id) throw new Error('Could not add kid.');
          this.children.set(child.id,{id:child.id,name:child.name||child.id});
          socket.send(JSON.stringify({type:'kid.result',requestId:message.requestId,ok:true,child:{id:child.id,name:child.name||child.id}}));
          this.#broadcastChildren();
        }).catch(error=>socket.send(JSON.stringify({type:'kid.result',requestId:message.requestId,ok:false,error:String(error?.message||'Could not add kid.')})));
        return;
      }
      if(message?.type==='kid.delete'){
        const childId=String(message.childId||'').trim();
        if(!this.children.has(childId)){ socket.send(JSON.stringify({type:'kid.result',requestId:message.requestId,ok:false,error:'Kid was not found.'})); return; }
        Promise.resolve(this.deleteChild?.({childId})).then(()=>{
          this.children.delete(childId);
          const bound=this.childSockets.get(childId); if(bound) this.childSockets.delete(childId);
          this.childVersions.delete(childId);
          socket.send(JSON.stringify({type:'kid.result',requestId:message.requestId,ok:true,childId}));
          this.#broadcastChildren();
        }).catch(error=>socket.send(JSON.stringify({type:'kid.result',requestId:message.requestId,ok:false,error:String(error?.message||'Could not delete kid.')})));
        return;
      }
      if(message?.type==='extension.ping'||message?.type==='turn.ack') return;
      if(message?.type==='tab.bind'){
        const childId=String(message.childId||'').trim();
        if(!this.children.has(childId)){ socket.send(JSON.stringify({type:'bridge.error',error:'unknown child'})); return; }
        const version=String(message.version||'0.0.0');
        const prior=this.childSockets.get(childId);
        const priorVersion=this.childVersions.get(childId)||'0.0.0';
        const parts=v=>String(v).split('.').map(n=>Number(n)||0);
        const a=parts(version),b=parts(priorVersion);
        const cmp=(a[0]-b[0])||(a[1]-b[1])||(a[2]-b[2]);
        if(prior&&prior!==socket&&prior.readyState===WebSocket.OPEN&&cmp<0) return;
        if(prior&&prior!==socket&&prior.readyState===WebSocket.OPEN) prior.close(4000,'child rebound');
        bindings.add(childId);
        this.childSockets.set(childId,socket);
        this.childVersions.set(childId,version);
        this.#dispatch(childId);
        return;
      }
      if(message?.type==='turn.error'){
        const id=String(message.correlation?.correlationId||'');
        const state=this.correlations.get(id);
        this.lastExtensionError={childId:String(message.childId||''),error:String(message.error||'extension turn failed'),at:new Date().toISOString()};
        console.error('[family-tutor] extension turn failed',this.lastExtensionError);
        if(state&&state.childId===message.childId) this.fail(id,new Error(this.lastExtensionError.error)).catch(()=>{});
      }
    });
    socket.on('close',()=>{
      for(const childId of bindings) if(this.childSockets.get(childId)===socket){ this.childSockets.delete(childId); this.childVersions.delete(childId); }
    });
  }

  #authorized(req,url){
    return req.headers.authorization===`Bearer ${this.token}`||url?.searchParams.get('token')===this.token;
  }

  async #mcp(body){
    const {id,method,params={}}=body||{};
    if(method==='initialize') return {jsonrpc:'2.0',id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'family-tutor-browser-bridge',version:'0.1.0'}}};
    if(method==='notifications/initialized') return null;
    if(method==='ping') return {jsonrpc:'2.0',id,result:{}};
    if(method==='tools/list') return {jsonrpc:'2.0',id,result:{tools:[{name:'reply_to_discord',title:'Reply to Discord',description:'Reply to the exact Discord child message associated with an active Family Tutor correlation id. Use final=false for a concise progress update and final=true for the final response.',securitySchemes:[{type:'oauth2',scopes:['tutor']}],annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false,idempotentHint:false},_meta:{securitySchemes:[{type:'oauth2',scopes:['tutor']}],ui:{visibility:['model','app']},'openai/toolInvocation/invoking':'Sending Family Tutor reply…','openai/toolInvocation/invoked':'Family Tutor reply sent'},inputSchema:{type:'object',additionalProperties:false,required:['correlationId','text'],properties:{correlationId:{type:'string',minLength:1,maxLength:160,description:'Opaque correlation id supplied by Family Tutor for the active Discord turn.'},text:{type:'string',minLength:1,maxLength:12000,description:'Student-facing reply text to send to the originating Discord message.'},final:{type:'boolean',default:true,description:'Set false for a progress update and true for the final reply.'}}}}]}};
    if(method==='tools/call'){
      if(params?.name!=='reply_to_discord') return {jsonrpc:'2.0',id,result:textResult({error:'unknown tool'},true)};
      try{return {jsonrpc:'2.0',id,result:textResult(await this.reply(params.arguments?.correlationId,params.arguments?.text,{final:params.arguments?.final!==false}))};}
      catch(error){return {jsonrpc:'2.0',id,result:textResult({error:String(error?.message||error)},true)};}
    }
    return {jsonrpc:'2.0',id,error:{code:-32601,message:`Method not found: ${method}`}};
  }

  async #handle(req,res){
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&url.pathname==='/.well-known/oauth-protected-resource') return json(res,200,{resource:this.#oauthResource(),authorization_servers:[this.publicOrigin],scopes_supported:['tutor'],resource_documentation:`${this.publicOrigin}/`});
    if(req.method==='GET'&&(url.pathname==='/.well-known/oauth-authorization-server'||url.pathname==='/.well-known/openid-configuration')) return json(res,200,{issuer:this.publicOrigin,authorization_endpoint:`${this.publicOrigin}/oauth/authorize`,token_endpoint:`${this.publicOrigin}/oauth/token`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_post','client_secret_basic','none'],scopes_supported:['tutor','extension']});
    if(req.method==='GET'&&url.pathname==='/oauth/authorize') return this.#oauthAuthorize(url,res);
    if(req.method==='POST'&&url.pathname==='/oauth/token') return this.#oauthToken(req,res);
    if(req.method==='POST'&&url.pathname==='/mcp/reply'){
      if(!this.#authorized(req,url)) return json(res,401,{error:'unauthorized'});
      const body=await readJson(req);
      try{return json(res,200,await this.reply(body.correlationId,body.text));}
      catch(error){return json(res,400,{error:String(error?.message||error)});}
    }
    if(req.method==='POST'&&url.pathname==='/mcp'){
      if(!this.#mcpAuthorized(req)) return json(res,401,{error:'unauthorized'},{'www-authenticate':this.#oauthChallenge()});
      const response=await this.#mcp(await readJson(req));
      if(response===null){res.writeHead(202);return res.end();}
      return json(res,200,response);
    }
    if(process.env.FAMILY_TUTOR_E2E_PROBE==='1'&&req.method==='POST'&&url.pathname==='/v1/e2e/turn'){
      if(!this.#authorized(req,url)) return json(res,401,{error:'unauthorized'});
      const body=await readJson(req);
      const turn=await this.enqueue({childId:body.childId,text:body.text||'',attachments:body.attachments||[],origin:body.origin||{}});
      return json(res,200,{correlationId:turn.correlationId});
    }
    if(!this.#authorized(req,url)) return json(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/v1/turns/next'){
      const turn=this.next(url.searchParams.get('childId')||'');
      if(!turn){res.writeHead(204,{'cache-control':'no-store'});return res.end();}
      return json(res,200,turn);
    }
    if(req.method==='GET'&&url.pathname==='/v1/status'){
      return json(res,200,{ok:true,boundChildren:[...this.childSockets.keys()].sort(),boundVersions:Object.fromEntries([...this.childVersions.entries()].sort()),inFlight:[...this.inFlight.keys()].sort(),lastExtensionError:this.lastExtensionError});
    }
    if(req.method==='POST'&&/^\/v1\/turns\/[^/]+\/failed$/.test(url.pathname)){
      const id=decodeURIComponent(url.pathname.split('/')[3]);
      return json(res,200,{ok:await this.fail(id)});
    }
    const blob=url.pathname.match(/^\/v1\/blobs\/([^/]+)\/([^/]+)$/);
    if(req.method==='GET'&&blob){
      const id=decodeURIComponent(blob[1]),name=safeName(decodeURIComponent(blob[2]));
      const state=this.correlations.get(id);
      if(!state) return json(res,404,{error:'not found'});
      const filePath=path.join(state.blobDir,name);
      if(!fs.existsSync(filePath)) return json(res,404,{error:'not found'});
      res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store'});
      return fs.createReadStream(filePath).pipe(res);
    }
    return json(res,404,{error:'not found'});
  }
}
