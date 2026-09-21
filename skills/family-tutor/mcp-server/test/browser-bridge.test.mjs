import assert from 'node:assert/strict';
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
      prompt:'help',
      attachments:[{url:`http://127.0.0.1:${source.address().port}/x.png`,name:'x.png',mimeType:'image/png',size:13}],
      origin:{channelId:'thread-1',threadId:'thread-1',messageId:'m1'},
    });
    const payload=await message;
    assert.equal(payload.type,'turn');
    assert.equal(payload.childId,'kid1');
    assert.match(payload.prompt,/help/);
    assert.match(payload.prompt,/Correlation ID:/);
    assert.match(payload.prompt,/reply_to_discord/);
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
