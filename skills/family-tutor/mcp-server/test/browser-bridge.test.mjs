import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { BrowserBridge } from '../src/browser-bridge.mjs';

function imageServer(){return http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'image/png'});res.end('private-image');});}
async function post(url,token,body){return fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});}

test('pushes correlated image turn over WebSocket and MCP replies to exact origin',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-browser-'));
  const source=imageServer(); await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));
  const replies=[];
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,replyToDiscord:async value=>replies.push(value)}).start();
  let socket;
  try{
    const token=fs.readFileSync(path.join(root,'.browser-bridge','token'),'utf8').trim();
    socket=new WebSocket(`${bridge.websocketEndpoint()}?token=${token}`);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    socket.send(JSON.stringify({type:'tab.bind',childId:'kid1'}));
    const message=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('WebSocket turn timeout')),1500);
      const onMessage=data=>{
        const value=JSON.parse(data.toString());
        if(value.type!=='turn') return;
        clearTimeout(timer);
        socket.off('message',onMessage);
        resolve(value);
      };
      socket.on('message',onMessage);
    });
    const turnPromise=bridge.turn({
      childId:'kid1',
      prompt:'<FAMILY_TUTOR_CONTEXT>\n{"type":"kid","data":{"childId":"kid1","studentMessage":"help"}}\n</FAMILY_TUTOR_CONTEXT>',
      attachments:[{url:`http://127.0.0.1:${source.address().port}/x.png`,name:'x.png',mimeType:'image/png',size:13}],
      origin:{channelId:'thread-1',threadId:'thread-1',messageId:'m1'},
    });
    const payload=await message;
    assert.equal(payload.type,'turn');
    assert.equal(payload.childId,'kid1');
    assert.match(payload.prompt,/help/);
    assert.match(payload.prompt,/\"type\":\"kid\"/);
    assert.match(payload.prompt,/\"correlationId\":\"/);
    assert.doesNotMatch(payload.prompt,/Family Tutor Discord delivery|reply_to_discord|progress|final=true/);
    assert.equal(payload.correlation.correlationId.length>20,true);
    assert.equal(payload.origin,undefined);
    const blobUrl=new URL(payload.attachments[0].url);
    blobUrl.searchParams.set('token',payload.attachments[0].token);
    const blob=await fetch(blobUrl); assert.equal(await blob.text(),'private-image');
    const progress=await post(`${bridge.endpoint()}/mcp`,token,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'reply_to_discord',arguments:{correlationId:payload.correlation.correlationId,text:'working',final:false}}});
    const progressBody=await progress.json(); assert.equal(progressBody.result.isError,undefined);
    assert.equal(replies[0].origin.messageId,'m1'); assert.equal(replies[0].origin.threadId,'thread-1'); assert.equal(replies[0].text,'working');
    const stillThere=await fetch(blobUrl); assert.equal(await stillThere.text(),'private-image');
    const mcp=await post(`${bridge.endpoint()}/mcp`,token,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'reply_to_discord',arguments:{correlationId:payload.correlation.correlationId,text:'answer',final:true}}});
    const mcpBody=await mcp.json(); assert.equal(mcpBody.result.isError,undefined);
    assert.equal(replies[1].text,'answer');
    assert.deepEqual(await turnPromise,{ok:true,childId:'kid1'});
    const gone=await fetch(blobUrl); assert.equal(gone.status,404);
  }finally{socket?.close(); await bridge.stop(); await new Promise(resolve=>source.close(resolve)); fs.rmSync(root,{recursive:true,force:true});}
});

test('serializes per child and rejects cross-child or unauthenticated access',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-browser-'));
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'kid1'},{id:'kid2'}],host:'127.0.0.1',port:0,replyToDiscord:async()=>{}}).start();
  try{
    const a=await bridge.enqueue({childId:'kid1',text:'one',origin:{channelId:'c',messageId:'m1'}});
    await bridge.enqueue({childId:'kid1',text:'two',origin:{channelId:'c',messageId:'m2'}});
    const token=fs.readFileSync(path.join(root,'.browser-bridge','token'),'utf8').trim();
    const first=await fetch(`${bridge.endpoint()}/v1/turns/next?childId=kid1`,{headers:{authorization:`Bearer ${token}`}}); assert.equal((await first.json()).text,'one');
    const blocked=await fetch(`${bridge.endpoint()}/v1/turns/next?childId=kid1`,{headers:{authorization:`Bearer ${token}`}}); assert.equal(blocked.status,204);
    const unauthorized=await fetch(`${bridge.endpoint()}/v1/turns/next?childId=kid2`); assert.equal(unauthorized.status,401);
    const status=await fetch(`${bridge.endpoint()}/v1/status`,{headers:{authorization:`Bearer ${token}`}});
    assert.equal(status.status,200);
    assert.deepEqual((await status.json()).inFlight,['kid1']);
    await bridge.reply(a.correlationId,'done');
    const second=await fetch(`${bridge.endpoint()}/v1/turns/next?childId=kid1`,{headers:{authorization:`Bearer ${token}`}}); assert.equal((await second.json()).text,'two');
    await assert.rejects(bridge.enqueue({childId:'other',text:'no',origin:{channelId:'c',messageId:'m3'}}),/unknown child/);
  }finally{await bridge.stop(); fs.rmSync(root,{recursive:true,force:true});}
});

test('preserves parent request data and adds only the active correlation id',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-browser-parent-'));
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,replyToDiscord:async()=>{}}).start();
  let socket;
  try{
    const token=fs.readFileSync(path.join(root,'.browser-bridge','token'),'utf8').trim();
    socket=new WebSocket(`${bridge.websocketEndpoint()}?token=${token}`);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    socket.send(JSON.stringify({type:'tab.bind',childId:'kid1'}));
    const message=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('WebSocket parent turn timeout')),1500);
      const onMessage=data=>{
        const value=JSON.parse(data.toString());
        if(value.type!=='turn') return;
        clearTimeout(timer); socket.off('message',onMessage); resolve(value);
      };
      socket.on('message',onMessage);
    });
    const turnPromise=bridge.turn({
      childId:'kid1',
      prompt:'<FAMILY_TUTOR_CONTEXT>\n{"type":"parent","data":{"targetChild":"kid1","request":"reminder","message":"review fractions"}}\n</FAMILY_TUTOR_CONTEXT>',
      origin:{channelId:'parent-channel-id',messageId:'parent-message-id'},
    });
    const payload=await message;
    const envelope=JSON.parse(payload.prompt.match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/)[1]);
    assert.equal(envelope.type,'parent');
    assert.deepEqual(envelope.data,{targetChild:'kid1',request:'reminder',message:'review fractions',correlationId:payload.correlation.correlationId});
    assert.doesNotMatch(payload.prompt,/Family Tutor Discord delivery|reply_to_discord|parent-channel-id|parent-message-id/);
    const firstReply=await bridge.reply(payload.correlation.correlationId,'done');
    assert.equal(firstReply.duplicate,undefined);
    await turnPromise;
    const duplicate=await bridge.reply(payload.correlation.correlationId,'done again');
    assert.deepEqual(duplicate,{ok:true,childId:'kid1',correlationId:payload.correlation.correlationId,final:true,duplicate:true});
  }finally{socket?.close(); await bridge.stop(); fs.rmSync(root,{recursive:true,force:true});}
});

test('publishes OAuth discovery and accepts ChatGPT-style authorization-code PKCE tokens for MCP',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-oauth-'));
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,replyToDiscord:async()=>{}}).start();
  try{
    const metadata=await fetch(`${bridge.endpoint()}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.status,200);
    const protectedResource=await metadata.json();
    assert.equal(protectedResource.resource,'https://family-tutor.qili2.com/mcp');
    assert.deepEqual(protectedResource.authorization_servers,['https://family-tutor.qili2.com']);
    assert.deepEqual(protectedResource.scopes_supported,['tutor']);

    const authMetadata=await fetch(`${bridge.endpoint()}/.well-known/oauth-authorization-server`);
    assert.equal(authMetadata.status,200);
    const authDocument=await authMetadata.json();
    assert.equal(authDocument.authorization_endpoint,'https://family-tutor.qili2.com/oauth/authorize');
    assert.equal(authDocument.token_endpoint,'https://family-tutor.qili2.com/oauth/token');
    assert.deepEqual(authDocument.code_challenge_methods_supported,['S256']);
    assert.equal(authDocument.token_endpoint_auth_methods_supported.includes('client_secret_post'),true);

    const unauthenticated=await fetch(`${bridge.endpoint()}/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});
    assert.equal(unauthenticated.status,401);
    assert.match(unauthenticated.headers.get('www-authenticate'),/oauth-protected-resource/);

    const verifier=crypto.randomBytes(32).toString('base64url');
    const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri='https://chatgpt.com/connector/oauth/test-callback';
    const authorize=new URL(`${bridge.endpoint()}/oauth/authorize`);
    authorize.searchParams.set('response_type','code');
    authorize.searchParams.set('client_id','family-tutor-chatgpt');
    authorize.searchParams.set('redirect_uri',redirectUri);
    authorize.searchParams.set('scope','tutor');
    authorize.searchParams.set('resource','https://family-tutor.qili2.com/mcp');
    authorize.searchParams.set('state','state-1');
    authorize.searchParams.set('code_challenge',challenge);
    authorize.searchParams.set('code_challenge_method','S256');
    const authorization=await fetch(authorize,{redirect:'manual'});
    assert.equal(authorization.status,302);
    const callback=new URL(authorization.headers.get('location'));
    assert.equal(callback.origin,'https://chatgpt.com');
    assert.equal(callback.searchParams.get('state'),'state-1');
    const code=callback.searchParams.get('code');
    assert.ok(code);

    const secret=fs.readFileSync(path.join(root,'.browser-bridge','oauth-client-secret'),'utf8').trim();
    const form=new URLSearchParams({
      grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:'family-tutor-chatgpt',client_secret:secret,
      code_verifier:verifier,resource:'https://family-tutor.qili2.com/mcp',
    });
    const tokenResponse=await fetch(`${bridge.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
    assert.equal(tokenResponse.status,200);
    const token=await tokenResponse.json();
    assert.equal(token.token_type,'Bearer');
    assert.equal(token.scope,'tutor');
    assert.ok(token.access_token.startsWith('ft1.'));

    const initialized=await fetch(`${bridge.endpoint()}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
    assert.equal(initialized.status,200);
    assert.equal((await initialized.json()).result.serverInfo.name,'family-tutor-browser-bridge');

    const listed=await fetch(`${bridge.endpoint()}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list',params:{}})});
    const listedBody=await listed.json();
    assert.equal(listedBody.result.tools[0].name,'reply_to_discord');
    assert.deepEqual(listedBody.result.tools[0].securitySchemes,[{type:'oauth2',scopes:['tutor']}]);
  }finally{await bridge.stop(); fs.rmSync(root,{recursive:true,force:true});}
});

test('extension OAuth/PKCE issues a public-client session accepted by hosted websocket',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-hosted-ws-'));
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,token:'hosted-family-session-token-1234567890',replyToDiscord:async()=>{}}).start();
  let socket;
  try{
    const verifier=crypto.randomBytes(32).toString('base64url');
    const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri='https://cbhalklofapefdghfgdglmdfkeohdegm.chromiumapp.org/family-tutor';
    const authorize=new URL(`${bridge.endpoint()}/oauth/authorize`);
    authorize.searchParams.set('response_type','code');
    authorize.searchParams.set('client_id','family-tutor-extension');
    authorize.searchParams.set('redirect_uri',redirectUri);
    authorize.searchParams.set('scope','extension');
    authorize.searchParams.set('resource','https://family-tutor.qili2.com/ws');
    authorize.searchParams.set('state','ext-state');
    authorize.searchParams.set('code_challenge',challenge);
    authorize.searchParams.set('code_challenge_method','S256');
    const authorization=await fetch(authorize,{redirect:'manual'});
    assert.equal(authorization.status,302);
    const callback=new URL(authorization.headers.get('location'));
    assert.equal(callback.origin,'https://cbhalklofapefdghfgdglmdfkeohdegm.chromiumapp.org');
    assert.equal(callback.searchParams.get('state'),'ext-state');
    const code=callback.searchParams.get('code');
    assert.ok(code);

    const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:'family-tutor-extension',code_verifier:verifier,resource:'https://family-tutor.qili2.com/ws'});
    const tokenResponse=await fetch(`${bridge.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
    assert.equal(tokenResponse.status,200);
    const token=await tokenResponse.json();
    assert.equal(token.scope,'extension');
    assert.ok(token.access_token.startsWith('ft1.'));
    assert.ok(token.refresh_token.startsWith('ftr1.'));

    const refreshForm=new URLSearchParams({grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:'family-tutor-extension',resource:'https://family-tutor.qili2.com/ws'});
    const refreshResponse=await fetch(`${bridge.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshForm});
    assert.equal(refreshResponse.status,200);
    const refreshed=await refreshResponse.json();
    assert.equal(refreshed.scope,'extension');
    assert.ok(refreshed.access_token.startsWith('ft1.'));

    socket=new WebSocket(bridge.websocketEndpoint(),{origin:'chrome-extension://cbhalklofapefdghfgdglmdfkeohdegm',headers:{Host:'family-tutor.qili2.com'}});
    const first=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('hosted auth prompt timeout')),1500);
      socket.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});
      socket.once('error',reject);
    });
    assert.equal(first.type,'bridge.auth.required');
    socket.send(JSON.stringify({type:'bridge.auth',token:refreshed.access_token}));
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('hosted ready timeout')),1500);
      socket.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});
      socket.once('error',reject);
    });
    assert.equal(ready.type,'bridge.ready');
    assert.deepEqual(ready.children,[{id:'kid1',name:'kid1'}]);
  }finally{socket?.close(); await bridge.stop(); fs.rmSync(root,{recursive:true,force:true});}
});


test('extension can add and delete kids while child display names stay separate from ids',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-kids-'));
  const added=[]; const deleted=[];
  const bridge=await new BrowserBridge({
    instanceDir:root,children:[{id:'sammy',name:'Sammy'}],host:'127.0.0.1',port:0,
    addChild:async({name})=>{const child={id:'new-kid',name};added.push(child);return child;},
    deleteChild:async({childId})=>{deleted.push(childId);return {childId};},
    replyToDiscord:async()=>{},
  }).start();
  let socket;
  try{
    const token=fs.readFileSync(path.join(root,'.browser-bridge','token'),'utf8').trim();
    socket=new WebSocket(`${bridge.websocketEndpoint()}?token=${token}`);
    const messages=[]; const waiters=[];
    socket.on('message',data=>{
      const value=JSON.parse(data.toString());
      const index=waiters.findIndex(waiter=>waiter.predicate(value));
      if(index>=0){const [waiter]=waiters.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(value);}
      else messages.push(value);
    });
    const waitFor=predicate=>{
      const found=messages.findIndex(predicate);
      if(found>=0) return Promise.resolve(messages.splice(found,1)[0]);
      return new Promise((resolve,reject)=>{
        const waiter={predicate,resolve,reject,timer:null};
        waiter.timer=setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0) waiters.splice(i,1);reject(new Error('kid response timeout'));},1500);
        waiters.push(waiter);
      });
    };
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    const ready=await waitFor(value=>value.type==='bridge.ready');
    assert.deepEqual(ready.children,[{id:'sammy',name:'Sammy'}]);
    socket.send(JSON.stringify({type:'kid.add',requestId:'add-1',name:'New Kid'}));
    const addedResult=await waitFor(value=>value.type==='kid.result'&&value.requestId==='add-1');
    assert.equal(addedResult.ok,true);
    assert.deepEqual(added,[{id:'new-kid',name:'New Kid'}]);
    const afterAdd=await waitFor(value=>value.type==='bridge.ready'&&value.children.some(child=>child.id==='new-kid'));
    assert.equal(afterAdd.children.find(child=>child.id==='new-kid').name,'New Kid');
    socket.send(JSON.stringify({type:'kid.delete',requestId:'delete-1',childId:'new-kid'}));
    const deletedResult=await waitFor(value=>value.type==='kid.result'&&value.requestId==='delete-1');
    assert.equal(deletedResult.ok,true);
    assert.deepEqual(deleted,['new-kid']);
    const afterDelete=await waitFor(value=>value.type==='bridge.ready'&&!value.children.some(child=>child.id==='new-kid'));
    assert.deepEqual(afterDelete.children,[{id:'sammy',name:'Sammy'}]);
  }finally{socket?.close();await bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
});
