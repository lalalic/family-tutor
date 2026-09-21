import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function parseJsonl(text){
  let threadId=null, answer='', outputs=[];
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()) continue;
    let event; try{event=JSON.parse(line)}catch{continue}
    if(event.type==='thread.started' && event.thread_id) threadId=event.thread_id;
    const item=event.item||event;
    if(item.type==='agent_message' || item.type==='assistant_message') answer+=item.text||item.message||'';
    if(item.type==='file' && item.path) outputs.push({name:path.basename(item.path),path:item.path});
  }
  return {threadId,text:answer.trim(),outputs};
}

function run(args,prompt,cwd,timeoutMs){
  return new Promise((resolve,reject)=>{
    const child=spawn('codex',args,{cwd,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr=''; const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
    child.stdout.on('data',b=>stdout+=b); child.stderr.on('data',b=>stderr+=b);
    child.on('error',reject); child.on('close',code=>{clearTimeout(timer); if(code) reject(new Error(`codex exited ${code}: ${stderr.trim()||stdout.trim()}`)); else resolve(parseJsonl(stdout));});
    child.stdin.end(prompt);
  });
}

export async function prepareAttachments(attachments,childId,baseDir=os.tmpdir()){
  const dir=fs.mkdtempSync(path.join(baseDir,'.family-tutor-attachments-'));
  const files=[];
  try{
    for(const [i,a] of attachments.entries()){
      const response=await fetch(a.url,{signal:AbortSignal.timeout(30_000)});
      if(!response.ok) throw new Error(`attachment download failed (${response.status})`);
      const file=path.join(dir,`${i+1}-${path.basename(a.name||'attachment').replace(/[^a-z0-9._-]/gi,'_')}`);
      fs.writeFileSync(file,Buffer.from(await response.arrayBuffer())); files.push(file);
    }
    return {dir,files,descriptions:files.map((file,i)=>({path:file,name:attachments[i].name||path.basename(file),mimeType:attachments[i].mimeType||'application/octet-stream'}))};
  }catch(error){fs.rmSync(dir,{recursive:true,force:true}); throw error;}
}

export function buildTutorPrompt(childId,memory,prompt,attachments=[]){
  const contract=`You are a private, age-appropriate tutor for child ${childId}. Teach with hints and one focused question when useful; diagnose understanding and verify it with evidence. Keep this child's context isolated. Never reveal or discuss runtime control markers.\n\nControl protocol:\n- Emit <FAMILY_TUTOR_MEMORY>complete Markdown replacement for AGENTS.md</FAMILY_TUTOR_MEMORY> only when durable learner facts changed; do not put a transcript in it.\n- Emit <FAMILY_TUTOR_PARENT>concise learning telemetry: topic, evidence, misconception/progress, next step, and useful parent support</FAMILY_TUTOR_PARENT> when a parent update is useful; never mirror the raw transcript.\n- Emit <FAMILY_TUTOR_ROLLOVER/> only after all durable facts from the current thread are captured in FAMILY_TUTOR_MEMORY.\n- Keep all markers out of the child-visible answer; answer the child normally.\n\n<DURABLE_LEARNER_CONTEXT>\n${memory}\n</DURABLE_LEARNER_CONTEXT>`;
  const attachmentContext=attachments.length?`\n\n<LOCAL_ATTACHMENTS>\n${attachments.map(a=>`${a.name} (${a.mimeType}): ${a.path}`).join('\n')}\n</LOCAL_ATTACHMENTS>`:'';
  return `${contract}${attachmentContext}\n\n${prompt}`;
}

export function buildCodexArgv({childDir,threadId=null,model=null,imageFiles=[]}){
  const args=['exec','--json','--sandbox','read-only','--skip-git-repo-check','-C',childDir];
  if(model) args.push('--model',model);
  if(threadId){
    args.push('resume',threadId);
    for(const file of imageFiles) args.push('--image',file);
  }else{
    for(const file of imageFiles) args.push('--image',file);
  }
  return args;
}

export class CodexBackend{
  constructor(config,{instanceDir}){this.config=config; this.instanceDir=instanceDir;}
  childDir(childId){return path.join(this.instanceDir,childId);}
  stateFile(childId){return path.join(this.instanceDir,childId,'.codex-thread.json');}
  memoryFile(childId){return path.join(this.instanceDir,childId,'AGENTS.md');}
  readThread(childId){try{return JSON.parse(fs.readFileSync(this.stateFile(childId),'utf8')).threadId||null}catch{return null}}
  writeThread(childId,threadId){const file=this.stateFile(childId); fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp`; fs.writeFileSync(tmp,JSON.stringify({threadId},null,2)+'\n',{mode:0o600}); fs.renameSync(tmp,file);}
  async turn({childId,prompt,attachments=[]}){
    const memoryFile=this.memoryFile(childId);
    const memory=fs.existsSync(memoryFile)?fs.readFileSync(memoryFile,'utf8'):'';
    fs.mkdirSync(this.childDir(childId),{recursive:true});
    const thread=this.readThread(childId);
    let downloaded={dir:null,files:[],descriptions:[]};
    try{
      downloaded=await prepareAttachments(attachments,childId,this.childDir(childId));
      const imageFiles=downloaded.files.filter((_,i)=>String(attachments[i]?.mimeType||'').toLowerCase().startsWith('image/'));
      const args=buildCodexArgv({childDir:this.childDir(childId),threadId:thread,model:this.config.model,imageFiles});
      const result=await run(args,buildTutorPrompt(childId,memory,prompt,downloaded.descriptions),this.childDir(childId),(this.config.maxRuntimeSeconds||600)*1000+30_000);
      if(result.threadId) this.writeThread(childId,result.threadId);
      if(!result.text) throw new Error('Codex returned no assistant text');
      return result;
    }finally{if(downloaded.dir) fs.rmSync(downloaded.dir,{recursive:true,force:true});}
  }
  async newThread({childId}){const file=this.stateFile(childId); try{fs.unlinkSync(file)}catch(error){if(error.code!=='ENOENT') throw error;}}
}
