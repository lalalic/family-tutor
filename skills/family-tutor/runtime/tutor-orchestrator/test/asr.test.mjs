import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudioAttachments } from '../src/asr.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

test('Cloudflare Workers AI transcribes audio online without passing audio onward',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).startsWith('https://cdn.example/')) return new Response(Buffer.from('audio-bytes'),{status:200,headers:{'content-type':'audio/ogg'}});
    return Response.json({success:true,result:{text:'Online transcript'}});
  };
  const text=await transcribeAudioAttachments([{url:'https://cdn.example/voice.ogg',name:'voice.ogg',mimeType:'audio/ogg',size:11}],{
    fetchImpl,
    env:{CLOUDFLARE_ACCOUNT_ID:'acct',CLOUDFLARE_API_TOKEN:'secret',FAMILY_TUTOR_ASR_PROVIDER:'cloudflare',FAMILY_TUTOR_ASR_LOCAL_FALLBACK:'0'},
  });
  assert.equal(text,'Online transcript');
  assert.equal(calls.length,2);
  assert.match(calls[1].url,/accounts\/acct\/ai\/run\/@cf\/openai\/whisper-large-v3-turbo$/);
  const body=JSON.parse(calls[1].options.body);
  assert.equal(Buffer.from(body.audio,'base64').toString(),'audio-bytes');
  assert.equal(body.task,'transcribe');
  assert.equal(body.vad_filter,true);
});


test('Family Tutor ASR worker signs requests with a local private key',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-asr-test-'));
  try{
    const kp=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const privateBytes=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',kp.privateKey));
    const keyFile=path.join(dir,'key.pk8');
    await fs.writeFile(keyFile,privateBytes.toString('base64'));
    const calls=[];
    const fetchImpl=async(url,options={})=>{
      calls.push({url:String(url),options});
      if(String(url).startsWith('https://cdn.example/')) return new Response(Buffer.from('audio-bytes'),{status:200,headers:{'content-type':'audio/ogg'}});
      const timestamp=options.headers['x-ft-timestamp'];
      const nonce=options.headers['x-ft-nonce'];
      const signature=Buffer.from(options.headers['x-ft-signature'],'base64url');
      const signed=Buffer.from(`${timestamp}\n${nonce}\n${options.body}`);
      assert.equal(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},kp.publicKey,signature,signed),true);
      return Response.json({text:'Worker transcript'});
    };
    const text=await transcribeAudioAttachments([{url:'https://cdn.example/voice.ogg',name:'voice.ogg',mimeType:'audio/ogg',size:11}],{
      fetchImpl,
      env:{FAMILY_TUTOR_ASR_PROVIDER:'worker',FAMILY_TUTOR_ASR_ENDPOINT:'https://asr.example/',FAMILY_TUTOR_ASR_PRIVATE_KEY_FILE:keyFile,FAMILY_TUTOR_ASR_LOCAL_FALLBACK:'0'},
    });
    assert.equal(text,'Worker transcript');
    assert.equal(calls[1].url,'https://asr.example/');
    assert.equal(Buffer.from(JSON.parse(calls[1].options.body).audio,'base64').toString(),'audio-bytes');
    assert.ok(calls[1].options.headers['x-ft-nonce']);
    assert.ok(calls[1].options.headers['x-ft-signature']);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
