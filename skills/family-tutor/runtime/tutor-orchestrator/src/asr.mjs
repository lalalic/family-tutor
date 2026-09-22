import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const DEFAULT_LOCAL_MODEL='mlx-community/whisper-large-v3-turbo-asr-fp16';
const DEFAULT_CLOUDFLARE_MODEL='@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO_BYTES=25*1024*1024;
const AUDIO_EXTENSIONS=new Set(['.ogg','.opus','.mp3','.m4a','.wav','.webm','.aac','.flac','.aiff','.aif']);

export function isAudioAttachment(attachment){
  const type=String(attachment?.mimeType||attachment?.contentType||'').toLowerCase();
  if(type.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.has(path.extname(String(attachment?.name||'')).toLowerCase());
}

function safeExt(name){
  const ext=path.extname(String(name||'')).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext)?ext:'.audio';
}

async function downloadAudioBytes(attachment,fetchImpl=fetch){
  const declared=Number(attachment.size||0);
  if(declared>MAX_AUDIO_BYTES) throw new Error(`audio attachment exceeds ${MAX_AUDIO_BYTES} bytes`);
  const response=await fetchImpl(attachment.url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`audio download failed (${response.status})`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>MAX_AUDIO_BYTES) throw new Error(`audio attachment exceeds ${MAX_AUDIO_BYTES} bytes`);
  return bytes;
}

async function transcribeCloudflare(bytes,{fetchImpl=fetch,env=process.env}={}){
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!accountId||!token) throw new Error('Cloudflare Workers AI credentials are not configured');
  const model=String(env.FAMILY_TUTOR_ASR_CLOUDFLARE_MODEL||DEFAULT_CLOUDFLARE_MODEL).trim();
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const body={audio:bytes.toString('base64'),task:'transcribe',vad_filter:true};
  const language=String(env.FAMILY_TUTOR_ASR_LANGUAGE||'').trim();
  if(language) body.language=language;
  const response=await fetchImpl(endpoint,{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(120000),
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.success===false) throw new Error(`Cloudflare ASR failed (${response.status})`);
  const text=String(payload?.result?.text||payload?.text||'').trim();
  if(!text) throw new Error('Cloudflare ASR returned no transcript');
  return text;
}

async function transcribeLocal(bytes,name,env=process.env){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-asr-'));
  try{
    const input=path.join(dir,`input${safeExt(name)}`);
    const outputBase=path.join(dir,'transcript');
    await fs.writeFile(input,bytes,{mode:0o600});
    const model=env.FAMILY_TUTOR_ASR_MODEL?.trim()||DEFAULT_LOCAL_MODEL;
    const args=['--from','mlx-audio','mlx_audio.stt.generate','--model',model,'--audio',input,'--output-path',outputBase,'--format','txt'];
    if(env.FAMILY_TUTOR_ASR_LANGUAGE?.trim()) args.push('--language',env.FAMILY_TUTOR_ASR_LANGUAGE.trim());
    await execFileAsync('uvx',args,{timeout:10*60*1000,maxBuffer:4*1024*1024});
    return (await fs.readFile(`${outputBase}.txt`,'utf8')).trim();
  }finally{
    await fs.rm(dir,{recursive:true,force:true});
  }
}

async function transcribeOne(attachment,{fetchImpl=fetch,env=process.env}={}){
  const bytes=await downloadAudioBytes(attachment,fetchImpl);
  const provider=String(env.FAMILY_TUTOR_ASR_PROVIDER||'cloudflare').trim().toLowerCase();
  if(provider==='local') return transcribeLocal(bytes,attachment.name,env);
  try{
    return await transcribeCloudflare(bytes,{fetchImpl,env});
  }catch(error){
    if(String(env.FAMILY_TUTOR_ASR_LOCAL_FALLBACK||'1')!=='1') throw error;
    return transcribeLocal(bytes,attachment.name,env);
  }
}

export async function transcribeAudioAttachments(attachments=[],options={}){
  const audio=attachments.filter(isAudioAttachment);
  if(!audio.length) return null;
  const parts=[];
  for(const attachment of audio){
    const text=await transcribeOne(attachment,options);
    if(text) parts.push(text);
  }
  return parts.join('\n').trim()||null;
}
