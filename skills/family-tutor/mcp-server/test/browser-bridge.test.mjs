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

test('preserves parent context data and adds only the active correlation id',async()=>{
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
      prompt:'<FAMILY_TUTOR_CONTEXT>\n{"type":"parent","data":{"source":"parent","targetChild":"kid1","message":"review fractions","delivery":{"replyTo":"child","parentConfirmation":"runtime"}}}\n</FAMILY_TUTOR_CONTEXT>',
      origin:{channelId:'parent-channel-id',messageId:'parent-message-id'},
    });
    const payload=await message;
    const envelope=JSON.parse(payload.prompt.match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/)[1]);
    assert.equal(envelope.type,'parent');
    assert.deepEqual(envelope.data,{source:'parent',targetChild:'kid1',message:'review fractions',delivery:{replyTo:'child',parentConfirmation:'runtime'},correlationId:payload.correlation.correlationId});
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
    assert.ok(token.refresh_token.startsWith('ftr1.'));

    const refreshForm=new URLSearchParams({grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:'family-tutor-chatgpt',client_secret:secret});
    const refreshedResponse=await fetch(`${bridge.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshForm});
    assert.equal(refreshedResponse.status,200);
    const refreshed=await refreshedResponse.json();
    assert.equal(refreshed.scope,'tutor');
    assert.ok(refreshed.access_token.startsWith('ft1.'));
    assert.equal(refreshed.refresh_token,token.refresh_token);

    const initialized=await fetch(`${bridge.endpoint()}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
    assert.equal(initialized.status,200);
    assert.equal((await initialized.json()).result.serverInfo.name,'family-tutor-browser-bridge');

    const listed=await fetch(`${bridge.endpoint()}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list',params:{}})});
    const listedBody=await listed.json();
    assert.equal(listedBody.result.tools[0].name,'reply_to_discord');
    assert.deepEqual(listedBody.result.tools[0].securitySchemes,[{type:'oauth2',scopes:['tutor']}]);
  }finally{await bridge.stop(); fs.rmSync(root,{recursive:true,force:true});}
});

test('Discord install creates one-time family claim and family-scoped extension session',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-family-claim-'));
  const exchanges=[];
  const bridge=await new BrowserBridge({
    instanceDir:root,children:[{id:'sammy',name:'Sammy'},{id:'maggie',name:'Maggie'}],host:'127.0.0.1',port:0,
    token:'hosted-family-session-token-1234567890',replyToDiscord:async()=>{},
    discordOAuthExchange:async value=>{exchanges.push(value);return {guild:{id:value.hintedGuildId}};},
  }).start();
  let socket;
  try{
    const install=await fetch(`${bridge.endpoint()}/discord/install`,{redirect:'manual'});
    assert.equal(install.status,302);
    const discord=new URL(install.headers.get('location'));
    assert.equal(discord.hostname,'discord.com');
    assert.equal(discord.searchParams.get('client_id'),'1489316184578068755');
    assert.equal(discord.searchParams.get('permissions'),'68608');
    assert.match(discord.searchParams.get('scope'),/identify/);
    assert.match(discord.searchParams.get('scope'),/bot/);
    const state=discord.searchParams.get('state');
    assert.ok(state);

    const callback=await fetch(`${bridge.endpoint()}/discord/callback?state=${encodeURIComponent(state)}&code=discord-code&guild_id=guild-A`,{redirect:'manual'});
    assert.equal(callback.status,302);
    assert.equal(exchanges.length,1);
    const setup=new URL(callback.headers.get('location'));
    assert.equal(setup.origin,'https://family-tutor.qili2.com');
    assert.match(setup.pathname,/^\/setup\/[A-Za-z0-9_-]+$/);
    assert.equal(setup.href.includes('guild-A'),false);
    const claim=decodeURIComponent(setup.pathname.split('/').pop());

    const wrongClaim=await fetch(`${bridge.endpoint()}/v1/setup/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim:'wrong-'+claim})});
    assert.equal(wrongClaim.status,400);

    const claimResponse=await fetch(`${bridge.endpoint()}/v1/setup/claim`,{
      method:'POST',headers:{origin:'chrome-extension://cbhalklofapefdghfgdglmdfkeohdegm','content-type':'application/json'},body:JSON.stringify({claim}),
    });
    assert.equal(claimResponse.status,200);
    const session=await claimResponse.json();
    assert.deepEqual(session.children,[{id:'maggie',name:'Maggie'},{id:'sammy',name:'Sammy'}]);
    assert.ok(session.access_token.startsWith('ft1.'));
    assert.ok(session.refresh_token.startsWith('ftr1.'));
    const accessPayload=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString('utf8'));
    assert.ok(accessPayload.family_id);
    assert.equal(JSON.stringify(session).includes('guild-A'),false);

    const replay=await fetch(`${bridge.endpoint()}/v1/setup/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim})});
    assert.equal(replay.status,400);

    const refreshForm=new URLSearchParams({grant_type:'refresh_token',refresh_token:session.refresh_token,client_id:'family-tutor-extension',resource:'https://family-tutor.qili2.com/ws'});
    const refreshResponse=await fetch(`${bridge.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshForm});
    assert.equal(refreshResponse.status,200);
    const refreshed=await refreshResponse.json();
    const refreshedPayload=JSON.parse(Buffer.from(refreshed.access_token.split('.')[1],'base64url').toString('utf8'));
    assert.equal(refreshedPayload.family_id,accessPayload.family_id);

    socket=new WebSocket(bridge.websocketEndpoint(),{origin:'chrome-extension://cbhalklofapefdghfgdglmdfkeohdegm',headers:{Host:'family-tutor.qili2.com'}});
    const first=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('hosted auth prompt timeout')),1500);socket.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});socket.once('error',reject);});
    assert.equal(first.type,'bridge.auth.required');
    socket.send(JSON.stringify({type:'bridge.auth',token:refreshed.access_token}));
    const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('hosted ready timeout')),1500);socket.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});socket.once('error',reject);});
    assert.equal(ready.type,'bridge.ready');
    assert.deepEqual(ready.children,[{id:'maggie',name:'Maggie'},{id:'sammy',name:'Sammy'}]);

    const relink=await fetch(`${bridge.endpoint()}/discord/install`,{redirect:'manual'});
    const relinkState=new URL(relink.headers.get('location')).searchParams.get('state');
    const sameGuild=await fetch(`${bridge.endpoint()}/discord/callback?state=${encodeURIComponent(relinkState)}&code=discord-code-2&guild_id=guild-A`,{redirect:'manual'});
    assert.equal(sameGuild.status,302);
    const claim2=decodeURIComponent(new URL(sameGuild.headers.get('location')).pathname.split('/').pop());
    const relinkSessionResponse=await fetch(`${bridge.endpoint()}/v1/setup/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim:claim2})});
    assert.equal(relinkSessionResponse.status,200);
    const relinkSession=await relinkSessionResponse.json();
    const relinkPayload=JSON.parse(Buffer.from(relinkSession.access_token.split('.')[1],'base64url').toString('utf8'));
    assert.equal(relinkPayload.family_id,accessPayload.family_id);

    const other=await fetch(`${bridge.endpoint()}/discord/install`,{redirect:'manual'});
    const otherState=new URL(other.headers.get('location')).searchParams.get('state');
    const wrongGuild=await fetch(`${bridge.endpoint()}/discord/callback?state=${encodeURIComponent(otherState)}&code=discord-code-3&guild_id=guild-B`,{redirect:'manual'});
    assert.equal(wrongGuild.status,409);

    const secondRoot=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-family-claim-2-'));
    const second=await new BrowserBridge({instanceDir:secondRoot,children:[{id:'other'}],host:'127.0.0.1',port:0,token:'hosted-family-session-token-1234567890',replyToDiscord:async()=>{},discordOAuthExchange:async value=>({guild:{id:value.hintedGuildId}})}).start();
    try{
      const secondInstall=await fetch(`${second.endpoint()}/discord/install`,{redirect:'manual'});
      const secondState=new URL(secondInstall.headers.get('location')).searchParams.get('state');
      await fetch(`${second.endpoint()}/discord/callback?state=${encodeURIComponent(secondState)}&code=second-code&guild_id=guild-B`,{redirect:'manual'});
      const crossRefresh=await fetch(`${second.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:refreshForm});
      assert.equal(crossRefresh.status,400);
    }finally{await second.stop();fs.rmSync(secondRoot,{recursive:true,force:true});}

    const expiredInstall=await fetch(`${bridge.endpoint()}/discord/install`,{redirect:'manual'});
    const expiredState=new URL(expiredInstall.headers.get('location')).searchParams.get('state');
    const expiredCallback=await fetch(`${bridge.endpoint()}/discord/callback?state=${encodeURIComponent(expiredState)}&code=expired-code&guild_id=guild-A`,{redirect:'manual'});
    const expiredClaim=decodeURIComponent(new URL(expiredCallback.headers.get('location')).pathname.split('/').pop());
    for(const record of bridge.setupClaims.values()) record.expiresAt=0;
    const expired=await fetch(`${bridge.endpoint()}/v1/setup/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim:expiredClaim})});
    assert.equal(expired.status,400);

    const persisted=JSON.parse(fs.readFileSync(path.join(root,'.browser-bridge','family-installation.json'),'utf8'));
    assert.ok(persisted.familyId);
    assert.ok(persisted.guildKey);
    assert.equal(JSON.stringify(persisted).includes('guild-A'),false);
  }finally{socket?.close();await bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
});


test('legacy extension refresh token migrates to resource-scoped format',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-legacy-refresh-'));
  const signingSecret='test-refresh-signing-secret';
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'sammy',name:'Sammy'}],host:'127.0.0.1',port:0,token:signingSecret,replyToDiscord:async()=>{},discordOAuthExchange:async value=>({guild:{id:value.hintedGuildId}})}).start();
  try{
    const install=await fetch(`${bridge.endpoint()}/discord/install`,{redirect:'manual'});
    const state=new URL(install.headers.get('location')).searchParams.get('state');
    const callback=await fetch(`${bridge.endpoint()}/discord/callback?state=${encodeURIComponent(state)}&code=legacy-code&guild_id=guild-A`,{redirect:'manual'});
    const claim=decodeURIComponent(new URL(callback.headers.get('location')).pathname.split('/').pop());
    const claimed=await fetch(`${bridge.endpoint()}/v1/setup/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim})});
    const session=await claimed.json();
    const accessPayload=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString('utf8'));
    const legacyPayload=Buffer.from(JSON.stringify({iss:'https://family-tutor.qili2.com',client_id:'family-tutor-extension',scope:'extension_refresh',family_id:accessPayload.family_id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    const legacySignature=crypto.createHmac('sha256',signingSecret).update(`ftr1.${legacyPayload}`).digest('base64url');
    const legacy=`ftr1.${legacyPayload}.${legacySignature}`;
    const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:legacy,client_id:'family-tutor-extension'});
    const response=await fetch(`${bridge.endpoint()}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
    assert.equal(response.status,200);
    const refreshed=await response.json();
    assert.notEqual(refreshed.refresh_token,legacy);
    const modern=JSON.parse(Buffer.from(refreshed.refresh_token.split('.')[1],'base64url').toString('utf8'));
    assert.equal(modern.resource,'https://family-tutor.qili2.com/ws');
    assert.equal(modern.family_id,accessPayload.family_id);
  }finally{await bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
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


test('request_new_thread immediately tells the bound extension to rotate',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-rotate-'));
  const bridge=await new BrowserBridge({instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,replyToDiscord:async()=>{}}).start();
  let socket;
  try{
    const token=fs.readFileSync(path.join(root,'.browser-bridge','token'),'utf8').trim();
    socket=new WebSocket(`${bridge.websocketEndpoint()}?token=${token}`);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    socket.send(JSON.stringify({type:'tab.bind',childId:'kid1',version:'2.6.1'}));
    const nextType=(type)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${type} timeout`)),1500);const onMessage=data=>{const value=JSON.parse(data.toString());if(value.type!==type)return;clearTimeout(timer);socket.off('message',onMessage);resolve(value);};socket.on('message',onMessage);});
    const turnMessage=nextType('turn');
    const turnPromise=bridge.turn({childId:'kid1',prompt:'<FAMILY_TUTOR_CONTEXT>\n{"type":"kid","data":{"childId":"kid1","studentMessage":"one"}}\n</FAMILY_TUTOR_CONTEXT>',origin:{channelId:'c',messageId:'m1'}});
    const turn=await turnMessage;
    const rotateMessage=nextType('thread.rotate');
    const requested=await post(`${bridge.endpoint()}/mcp`,token,{jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'request_new_thread',arguments:{correlationId:turn.correlation.correlationId,reason:'context long'}}});
    assert.match((await requested.json()).result.content[0].text,/"requested":true/);
    const rotate=await rotateMessage;
    assert.equal(rotate.childId,'kid1');
    assert.equal(rotate.correlation.correlationId,turn.correlation.correlationId);
    socket.send(JSON.stringify({type:'thread.rotated',childId:'kid1',correlation:rotate.correlation}));
    await bridge.reply(turn.correlation.correlationId,'done');
    await turnPromise;
  }finally{socket?.close();await bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('Discord callback verifies bot membership when OAuth client secret is unavailable',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-bot-verify-'));
  const priorSecret=process.env.DISCORD_CLIENT_SECRET;
  const priorBot=process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_CLIENT_SECRET;
  process.env.DISCORD_BOT_TOKEN='test-bot-token';
  const requests=[];
  const bridge=await new BrowserBridge({
    instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,token:'hosted-family-session-token-1234567890',replyToDiscord:async()=>{},
    fetchImpl:async(url,options={})=>{requests.push({url:String(url),authorization:options.headers?.authorization});return {ok:true,json:async()=>({id:'guild-A'})};},
  }).start();
  try{
    const install=await fetch(`${bridge.endpoint()}/discord/install`,{redirect:'manual'});
    const state=new URL(install.headers.get('location')).searchParams.get('state');
    const callback=await fetch(`${bridge.endpoint()}/discord/callback?state=${encodeURIComponent(state)}&code=opaque-code&guild_id=guild-A`,{redirect:'manual'});
    assert.equal(callback.status,302);
    assert.equal(requests.length,1);
    assert.match(requests[0].url,/\/guilds\/guild-A$/);
    assert.equal(requests[0].authorization,'Bot test-bot-token');
  }finally{
    await bridge.stop();fs.rmSync(root,{recursive:true,force:true});
    if(priorSecret===undefined) delete process.env.DISCORD_CLIENT_SECRET; else process.env.DISCORD_CLIENT_SECRET=priorSecret;
    if(priorBot===undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN=priorBot;
  }
});

test('preserves Discord audio attachment for ChatGPT upload',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-audio-'));
  const bridge=await new BrowserBridge({
    instanceDir:root,
    children:[{id:'kid1'}],
    host:'127.0.0.1',
    port:0,
    replyToDiscord:async()=>{},
    fetchImpl:async()=>new Response(Buffer.from('private-audio'),{status:200,headers:{'content-type':'audio/ogg'}}),
  }).start();
  try{
    await bridge.enqueue({
      childId:'kid1',
      text:'<FAMILY_TUTOR_CONTEXT>\n{"type":"kid","data":{"childId":"kid1","studentMessage":""}}\n</FAMILY_TUTOR_CONTEXT>',
      attachments:[{url:'https://cdn.discord.test/voice-message.ogg',name:'voice-message.ogg',mimeType:'audio/ogg',size:13}],
      origin:{channelId:'sammy',messageId:'audio-1'},
    });
    const turn=bridge.next('kid1');
    assert.equal(turn.attachments.length,1);
    assert.equal(turn.attachments[0].name,'1-voice-message.ogg');
    assert.equal(turn.attachments[0].mimeType,'audio/ogg');
    const token=fs.readFileSync(path.join(root,'.browser-bridge','token'),'utf8').trim();
    const audioUrl=new URL(turn.attachments[0].url); audioUrl.searchParams.set('token',token);
    const audio=await fetch(audioUrl);
    assert.equal(audio.status,200);
    assert.equal(audio.headers.get('content-type'),'audio/ogg');
    assert.equal(await audio.text(),'private-audio');
  }finally{await bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
});


test('passes arbitrary Discord files through to ChatGPT unchanged',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-file-'));
  const bridge=await new BrowserBridge({
    instanceDir:root,children:[{id:'kid1'}],host:'127.0.0.1',port:0,replyToDiscord:async()=>{},
    fetchImpl:async(url)=>{
      if(String(url).endsWith('.pdf')) return new Response(Buffer.from('%PDF-test'),{status:200,headers:{'content-type':'application/pdf'}});
      return new Response(Buffer.from('csv-data'),{status:200,headers:{'content-type':'text/csv'}});
    },
  }).start();
  try{
    await bridge.enqueue({
      childId:'kid1',text:'<FAMILY_TUTOR_CONTEXT>\n{"type":"kid","data":{"childId":"kid1","studentMessage":"check these"}}\n</FAMILY_TUTOR_CONTEXT>',
      attachments:[
        {url:'https://cdn.discord.test/homework.pdf',name:'homework.pdf',mimeType:'application/pdf',size:9},
        {url:'https://cdn.discord.test/scores.csv',name:'scores.csv',size:8},
      ],
      origin:{channelId:'sammy',messageId:'file-1'},
    });
    const turn=bridge.next('kid1');
    assert.deepEqual(turn.attachments.map(x=>[x.name,x.mimeType]),[[
      '1-homework.pdf','application/pdf'
    ],[
      '2-scores.csv','text/csv'
    ]]);
  }finally{await bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
});
