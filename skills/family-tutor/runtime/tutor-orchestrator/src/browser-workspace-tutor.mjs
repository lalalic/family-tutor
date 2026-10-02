import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

function sanitizeName(value='attachment'){
  return String(value).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)||'attachment';
}
function parseJSONLine(text,label){
  const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  for(let i=lines.length-1;i>=0;i--){ try{return JSON.parse(lines[i]);}catch{} }
  throw new Error(`${label} returned no JSON result`);
}
function threadIdFromLegacyUrl(value=''){
  try{return new URL(String(value)).pathname.replace(/\/$/,'').split('/').pop()||null;}catch{return null;}
}
function runProcess(command,args,{input='',env=process.env,timeoutMs=360000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});
    let stdout=''; let stderr='';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>stdout+=chunk); child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);
    const timer=setTimeout(()=>{ child.kill('SIGTERM'); reject(new Error(`${path.basename(command)} timed out`)); },timeoutMs);
    child.on('close',(code,signal)=>{
      clearTimeout(timer);
      if(code!==0) return reject(new Error(`${path.basename(command)} exited ${code}${signal?` (${signal})`:''}: ${(stderr||stdout).trim()}`));
      resolve({stdout,stderr});
    });
    if(input) child.stdin.write(input);
    child.stdin.end();
  });
}

export class BrowserWorkspaceTutorClient {
  constructor({instanceDir,workspace='Tutor',plugin='Family Tutor',skillRoot,browserWorkspaceCommand,loadAdmin=async helperPath=>import(pathToFileURL(helperPath).href),fetchImpl=fetch,run=runProcess}={}){
    if(!instanceDir) throw new Error('BrowserWorkspaceTutorClient requires instanceDir');
    this.instanceDir=instanceDir;
    this.workspace=workspace;
    this.plugin=plugin;
    this.skillRoot=skillRoot||null;
    this.cli=browserWorkspaceCommand||process.env.BROWSER_WORKSPACE_COMMAND||(skillRoot?path.join(skillRoot,'bin','browser-workspace'):'browser-workspace');
    this.loadAdmin=loadAdmin;
    this.admin=null;
    this.stateDir=path.join(instanceDir,'.family-tutor');
    this.bindingsFile=path.join(this.stateDir,'browser-workspace-bindings.json');
    this.fetch=fetchImpl;
    this.run=run;
    this.sessions=new Map();
    this.started=false;
  }

  async status(){
    const state=await this.#loadState();
    return {workspace:this.workspace,bindings:Object.values(state.bindings).map(binding=>({...binding,sessionReady:this.sessions.has(binding.learner)}))};
  }

  async bind({learner,projectId,threadId}){
    if(!learner||!projectId||!threadId) throw new Error('bind requires learner, projectId, and threadId');
    const state=await this.#loadState();
    state.bindings[learner]={learner,project_id:String(projectId),thread_id:String(threadId)};
    await this.#saveState(state);
    if(this.started) await this.#restartLearnerSession(learner);
    return state.bindings[learner];
  }

  async unbind({learner}){
    await this.#stopLearnerSession(learner);
    const state=await this.#loadState();
    const removed=state.bindings[learner]||null;
    delete state.bindings[learner];
    await this.#saveState(state);
    return {learner,removed:Boolean(removed)};
  }

  async setup({learner,projectName,instructions,initialPrompt=''}){
    await this.#stopLearnerSession(learner);
    const result=await this.#runPlatformAction('project-setup',{
      project_name:projectName,
      instructions,
      initial_prompt:initialPrompt,
    });
    const threadId=result.thread_id||threadIdFromLegacyUrl(result.thread_url);
    if(!result.project_id||!threadId) throw new Error('ChatGPT project setup returned no project_id/thread_id');
    const state=await this.#loadState();
    state.bindings[learner]={learner,project_id:String(result.project_id),thread_id:String(threadId)};
    await this.#saveState(state);
    if(this.started) await this.#ensureLearnerSession(learner);
    return {...result,thread_id:String(threadId)};
  }

  resetThread(args){ return this.setup(args); }

  async start(){
    if(this.started) return this.status();
    if(path.isAbsolute(this.cli) && !fs.existsSync(this.cli)) throw new Error(`browser-workspace CLI not installed: ${this.cli}`);
    const state=await this.#loadState();
    const size=Math.max(5,Object.keys(state.bindings).length);
    const status=parseJSONLine((await this.run(this.cli,['status'],{timeoutMs:60000})).stdout,'browser-workspace status');
    if(typeof status.admin_helper!=='string'||!path.isAbsolute(status.admin_helper)) throw new Error('browser-workspace status returned no absolute admin_helper path');
    const admin=await this.loadAdmin(status.admin_helper);
    if(typeof admin?.ensureWorkspace!=='function'||typeof admin?.deleteWorkspace!=='function') throw new Error('browser-workspace admin helper is missing workspace lifecycle exports');
    await admin.ensureWorkspace(this.workspace,size);
    this.admin=admin;
    this.started=true;
    try{
      for(const learner of Object.keys(state.bindings)) await this.#ensureLearnerSession(learner);
    }catch(error){
      await this.stop().catch(()=>{});
      throw error;
    }
    return this.status();
  }

  async stop(){
    const ids=[...this.sessions.values()].map(item=>item.sessionId);
    this.sessions.clear();
    this.started=false;
    await Promise.allSettled(ids.map(sessionId=>this.run(this.cli,['session','stop',sessionId],{timeoutMs:30000})));
    const admin=this.admin;
    this.admin=null;
    if(admin?.deleteWorkspace) await admin.deleteWorkspace(this.workspace,{force:true}).catch(()=>{});
    return {stopped:ids.length,workspace:this.workspace};
  }

  async submit({learner,prompt,attachments=[]}){
    const state=await this.#loadState();
    const binding=state.bindings[learner];
    if(!binding?.project_id||!binding?.thread_id) throw new Error(`No browser-workspace Tutor binding for learner ${learner}`);
    if(!this.started) throw new Error('Browser Workspace Tutor sessions are not started');
    const runtime=await this.#ensureLearnerSession(learner);
    const staged=await this.#stageAttachments(attachments);
    try{
      return await this.#runPlatformAction('submit-thread',{
        project_id:binding.project_id,
        thread_id:binding.thread_id,
        prompt,
        file:staged.map(item=>item.path),
        app:this.plugin,
      },{sessionId:runtime.sessionId});
    }finally{
      await Promise.allSettled(staged.map(item=>fsp.rm(item.path,{force:true})));
      if(staged.length) await fsp.rm(staged[0].dir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async #ensureLearnerSession(learner){
    const existing=this.sessions.get(learner);
    if(existing) return existing;
    const started=parseJSONLine((await this.run(this.cli,['session','start','--workspace',this.workspace],{timeoutMs:60000})).stdout,'browser-workspace session start');
    if(started.error) throw new Error(started.error);
    if(!started.session_id) throw new Error('browser-workspace session start returned no session_id');
    const runtime={sessionId:started.session_id,targetId:started.target_id||null};
    this.sessions.set(learner,runtime);
    return runtime;
  }

  async #stopLearnerSession(learner){
    const runtime=this.sessions.get(learner);
    if(!runtime) return false;
    this.sessions.delete(learner);
    await this.run(this.cli,['session','stop',runtime.sessionId],{timeoutMs:30000}).catch(()=>{});
    return true;
  }
  async #restartLearnerSession(learner){ await this.#stopLearnerSession(learner); return this.#ensureLearnerSession(learner); }

  async #runPlatformAction(action,config,{sessionId=null}={}){
    await fsp.mkdir(path.join(this.stateDir,'tmp'),{recursive:true,mode:0o700});
    const tempDir=await fsp.mkdtemp(path.join(this.stateDir,'tmp',`${action}-`));
    const configPath=path.join(tempDir,'config.json');
    try{
      await fsp.writeFile(configPath,JSON.stringify(config),{mode:0o600});
      const args=['platform','run','chatgpt',action,'--config',configPath];
      if(sessionId) args.push('--session-id',sessionId);
      const wrapper=parseJSONLine((await this.run(this.cli,args,{timeoutMs:360000})).stdout,`browser-workspace platform ${action}`);
      if(!wrapper?.result?.ok) throw new Error(wrapper?.result?.error||wrapper?.result?.stderr||`ChatGPT ${action} failed`);
      return parseJSONLine(wrapper.result.stdout,`ChatGPT ${action}`);
    }finally{
      await fsp.rm(tempDir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async #loadState(){
    try{
      const parsed=JSON.parse(await fsp.readFile(this.bindingsFile,'utf8'));
      const bindings={};
      for(const [learner,input] of Object.entries(parsed?.bindings||{})){
        const projectId=String(input?.project_id||'').trim();
        const threadId=String(input?.thread_id||threadIdFromLegacyUrl(input?.thread_url)||'').trim();
        if(projectId&&threadId) bindings[learner]={learner,project_id:projectId,thread_id:threadId};
      }
      const state={version:2,bindings};
      if(parsed?.version!==2 || Object.values(parsed?.bindings||{}).some(item=>item?.thread_url||item?.project_url||item?.target_id!==undefined)) await this.#saveState(state);
      return state;
    }catch(error){
      if(error?.code!=='ENOENT') throw error;
      return {version:2,bindings:{}};
    }
  }

  async #saveState(state){
    await fsp.mkdir(this.stateDir,{recursive:true,mode:0o700});
    const temp=`${this.bindingsFile}.tmp-${process.pid}`;
    await fsp.writeFile(temp,JSON.stringify({version:2,bindings:state.bindings},null,2)+'\n',{mode:0o600});
    await fsp.rename(temp,this.bindingsFile);
  }

  async #stageAttachments(attachments){
    if(!attachments.length) return [];
    await fsp.mkdir(path.join(this.stateDir,'tmp'),{recursive:true,mode:0o700});
    const dir=await fsp.mkdtemp(path.join(this.stateDir,'tmp','attachments-'));
    const staged=[];
    try{
      for(const [index,attachment] of attachments.slice(0,4).entries()){
        if(!attachment?.url) continue;
        const response=await this.fetch(attachment.url);
        if(!response.ok) throw new Error(`attachment download failed: HTTP ${response.status}`);
        const declared=Number(attachment.size||0);
        if(declared>25*1024*1024) throw new Error('attachment exceeds 25 MB Family Tutor limit');
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>25*1024*1024) throw new Error('attachment exceeds 25 MB Family Tutor limit');
        const localPath=path.join(dir,`${index+1}-${sanitizeName(attachment.name)}`);
        await fsp.writeFile(localPath,bytes,{mode:0o600});
        staged.push({path:localPath,dir});
      }
      return staged;
    }catch(error){
      await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }
}
