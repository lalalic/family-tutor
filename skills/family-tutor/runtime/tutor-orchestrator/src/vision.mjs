import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const UVX = process.env.FAMILY_TUTOR_UVX || '/opt/homebrew/bin/uvx';
const MODEL = process.env.FAMILY_TUTOR_VISION_MODEL || 'lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit';
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const VISION_TIMEOUT_MS = 180_000;

function imageAttachment(a) {
  const type=String(a.contentType||'').toLowerCase();
  if(type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(a.name||'');
}

export function collectImageAttachments(message) {
  return [...message.attachments.values()].filter(imageAttachment).slice(0,MAX_IMAGES);
}

async function downloadImage(attachment, dir, index) {
  if(Number(attachment.size||0)>MAX_IMAGE_BYTES) throw new Error(`${attachment.name||'image'} is larger than 12 MB`);
  const response=await fetch(attachment.url,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30_000)});
  if(!response.ok) throw new Error(`download failed (${response.status})`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>MAX_IMAGE_BYTES) throw new Error(`${attachment.name||'image'} is larger than 12 MB`);
  const ext=path.extname(attachment.name||'').slice(0,10) || '.jpg';
  const file=path.join(dir,`image-${index}${ext}`);
  await fs.writeFile(file,bytes,{mode:0o600});
  return file;
}

function runVision(files, studentText) {
  return new Promise((resolve,reject)=>{
    const prompt=[
      'Analyze these student-provided tutoring images. Ground your answer only in what is actually visible.',
      'Extract all readable question text, equations, labels, answer choices, handwritten work, and relevant diagram details.',
      'Do not solve the homework. This output will be passed to a separate tutor that will teach the student.',
      'Preserve ambiguity: if something is blurry, cropped, or uncertain, say exactly what is uncertain.',
      studentText ? `Student accompanying text: ${studentText}` : 'The student provided no accompanying text.',
      'Return a concise but complete markdown description suitable as grounded context for the tutor.'
    ].join('\n');
    const args=['--from','mlx-vlm','mlx_vlm.generate','--model',MODEL,'--prompt',prompt,'--image',...files,'--max-tokens','2400','--temperature','0'];
    const child=spawn(UVX,args,{stdio:['ignore','pipe','pipe'],env:process.env});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL'); reject(new Error('local image analysis timed out'));},VISION_TIMEOUT_MS);
    child.stdout.on('data',d=>{stdout+=d; if(stdout.length>200_000) stdout=stdout.slice(-200_000);});
    child.stderr.on('data',d=>{stderr+=d; if(stderr.length>100_000) stderr=stderr.slice(-100_000);});
    child.once('error',e=>{clearTimeout(timer); reject(e);});
    child.once('close',code=>{
      clearTimeout(timer);
      const text=stdout.trim();
      if(code!==0) return reject(new Error(`local image analysis failed (${code}): ${stderr.trim().slice(-1200)}`));
      if(!text) return reject(new Error('local image analysis returned no description'));
      resolve(text);
    });
  });
}

export async function understandImages(attachments, studentText='') {
  if(!attachments.length) return null;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-images-'));
  try {
    const files=[];
    for(let i=0;i<attachments.length;i++) files.push(await downloadImage(attachments[i],dir,i+1));
    return await runVision(files,studentText);
  } finally {
    await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}
