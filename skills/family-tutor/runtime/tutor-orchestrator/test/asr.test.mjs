import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudioAttachments } from '../src/asr.mjs';

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
