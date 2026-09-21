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
function json(res,status,body){
  const data=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'content-type':'application/json','content-length':String(data.length),'cache-control':'no-store'});
  res.end(data);
}
function textResult(value,isError=false){
  return {content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],...(isError?{isError:true}:{})};
}

export class BrowserBridge {
  constructor({instanceDir,children=[],host='127.0.0.1',port=8787,token=null,blobDir=null,fetchImpl=fetch,replyToDiscord=null,ttlMs=DEFAULT_TTL_MS,turnTimeoutMs=DEFAULT_TTL_MS}){
    this.instanceDir=instanceDir;
    this.root=path.join(instanceDir,'.browser-bridge');
    this.blobRoot=blobDir||path.join(this.root,'blobs');
    this.tokenFile=path.join(this.root,'token');
    this.children=new Set(children.map(child=>child.id));
    this.host=host;
    this.port=Number(port);
    this.fetchImpl=fetchImpl;
    this.replyToDiscord=replyToDiscord;
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
  }

  async start(){
    await fsp.mkdir(this.blobRoot,{recursive:true,mode:0o700});
    this.token=this.configuredToken||await this.#loadOrCreateToken();
    if(this.token.length<24) throw new Error('browser bridge token must be at least 24 characters');
    this.server=http.createServer((req,res)=>this.#handle(req,res).catch(error=>{
      console.error('[family-tutor] browser bridge request failed',error);
      if(!res.headersSent) json(res,500,{error:'bridge request failed'});
      else res.end();
    }));
    this.wsServer=new WebSocketServer({noServer:true});
    this.server.on('upgrade',(req,socket,head)=>this.#upgrade(req,socket,head));
    this.wsServer.on('connection',socket=>this.#connection(socket));
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
    const delivery=[
      turn.text,
      '',
      '[Family Tutor Discord delivery]',
      `Correlation ID: ${turn.correlationId}`,
      'Send a concise intermediate progress message with the MCP tool reply_to_discord using this correlationId and final=false.',
      'Then send the final student-facing response with reply_to_discord using the same correlationId and final=true.',
      'Do not ask the student for the correlation ID and do not rely on the browser UI response as delivery.',
    ].join('\n');
    return {
      type:'turn',
      childId:turn.childId,
      prompt:delivery,
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

  #connection(socket){
    const bindings=new Set();
    socket.send(JSON.stringify({type:'bridge.ready',children:[...this.children].sort()}));
    socket.on('message',raw=>{
      let message;
      try{ message=JSON.parse(raw.toString()); }catch{ return; }
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
    if(method==='tools/list') return {jsonrpc:'2.0',id,result:{tools:[{name:'reply_to_discord',description:'Reply to the exact Discord child message associated with an active Family Tutor correlation id. Use final=false for a concise progress update and final=true for the final response.',inputSchema:{type:'object',additionalProperties:false,required:['correlationId','text'],properties:{correlationId:{type:'string'},text:{type:'string',minLength:1},final:{type:'boolean',default:true}}}}]}};
    if(method==='tools/call'){
      if(params?.name!=='reply_to_discord') return {jsonrpc:'2.0',id,result:textResult({error:'unknown tool'},true)};
      try{return {jsonrpc:'2.0',id,result:textResult(await this.reply(params.arguments?.correlationId,params.arguments?.text,{final:params.arguments?.final!==false}))};}
      catch(error){return {jsonrpc:'2.0',id,result:textResult({error:String(error?.message||error)},true)};}
    }
    return {jsonrpc:'2.0',id,error:{code:-32601,message:`Method not found: ${method}`}};
  }

  async #handle(req,res){
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='POST'&&url.pathname==='/mcp/reply'){
      if(!this.#authorized(req,url)) return json(res,401,{error:'unauthorized'});
      const body=await readJson(req);
      try{return json(res,200,await this.reply(body.correlationId,body.text));}
      catch(error){return json(res,400,{error:String(error?.message||error)});}
    }
    if(req.method==='POST'&&url.pathname==='/mcp'){
      if(!this.#authorized(req,url)) return json(res,401,{error:'unauthorized'});
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
