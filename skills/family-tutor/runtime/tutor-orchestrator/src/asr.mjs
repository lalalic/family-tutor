import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const DEFAULT_MODEL='mlx-community/whisper-large-v3-turbo-asr-fp16';
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

async function downloadAudio(attachment,file){
  const declared=Number(attachment.size||0);
  if(declared>MAX_AUDIO_BYTES) throw new Error(`audio attachment exceeds ${MAX_AUDIO_BYTES} bytes`);
  const response=await fetch(attachment.url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`audio download failed (${response.status})`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>MAX_AUDIO_BYTES) throw new Error(`audio attachment exceeds ${MAX_AUDIO_BYTES} bytes`);
  await fs.writeFile(file,bytes,{mode:0o600});
}

async function transcribeFile(audioFile,outputBase){
  const model=process.env.FAMILY_TUTOR_ASR_MODEL?.trim()||DEFAULT_MODEL;
  const args=['--from','mlx-audio','mlx_audio.stt.generate','--model',model,'--audio',audioFile,'--output-path',outputBase,'--format','txt'];
  if(process.env.FAMILY_TUTOR_ASR_LANGUAGE?.trim()) args.push('--language',process.env.FAMILY_TUTOR_ASR_LANGUAGE.trim());
  await execFileAsync('uvx',args,{timeout:10*60*1000,maxBuffer:4*1024*1024});
  return (await fs.readFile(`${outputBase}.txt`,'utf8')).trim();
}

export async function transcribeAudioAttachments(attachments=[]){
  const audio=attachments.filter(isAudioAttachment);
  if(!audio.length) return null;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-asr-'));
  try{
    const parts=[];
    for(let i=0;i<audio.length;i++){
      const input=path.join(dir,`input-${i+1}${safeExt(audio[i].name)}`);
      const outputBase=path.join(dir,`transcript-${i+1}`);
      await downloadAudio(audio[i],input);
      const text=await transcribeFile(input,outputBase);
      if(text) parts.push(text);
    }
    return parts.join('\n').trim()||null;
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
}
