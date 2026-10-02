import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function sanitizeName(value='attachment'){
  return String(value).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)||'attachment';
}

function parseJSONLine(text,label){
  const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  for(let i=lines.length-1;i>=0;i--){
    try{return JSON.parse(lines[i]);}catch{}
  }
  throw new Error(`${label} returned no JSON result`);
}

function runProcess(command,args,{input='',env=process.env,timeoutMs=360000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});
    let stdout=''; let stderr='';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
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
  constructor({instanceDir,workspace='Tutor',skillRoot,fetchImpl=fetch,run=runProcess}={}){
    if(!instanceDir) throw new Error('BrowserWorkspaceTutorClient requires instanceDir');
    this.instanceDir=instanceDir;
    this.workspace=workspace;
    this.skillRoot=skillRoot||path.join(os.homedir(),'.agents','skills','browser-workspace');
    this.cli=path.join(this.skillRoot,'bin','browser-workspace');
    this.actionsDir=path.join(this.skillRoot,'platforms','chatgpt','actions');
    this.stateDir=path.join(instanceDir,'.family-tutor');
    this.bindingsFile=path.join(this.stateDir,'browser-workspace-bindings.json');
    this.fetch=fetchImpl;
    this.run=run;
  }

  async status(){
    const state=await this.#loadState();
    return {workspace:this.workspace,bindings:Object.values(state.bindings)};
  }

  async bind({learner,threadUrl,projectId=null,projectUrl=null}){
    if(!learner||!threadUrl) throw new Error('bind requires learner and threadUrl');
    const state=await this.#loadState();
    state.bindings[learner]={
      ...(state.bindings[learner]||{}),
      learner,
      project_id:projectId||state.bindings[learner]?.project_id||null,
      project_url:projectUrl||state.bindings[learner]?.project_url||null,
      thread_url:threadUrl,
      target_id:null,
    };
    await this.#saveState(state);
    return state.bindings[learner];
  }

  async unbind({learner}){
    const state=await this.#loadState();
    const removed=state.bindings[learner]||null;
    delete state.bindings[learner];
    await this.#saveState(state);
    return {learner,removed:Boolean(removed)};
  }

  async setup({learner,projectName,instructions,initialPrompt=''}){
    const result=await this.#runAction('project-setup',{
      project_name:projectName,
      instructions,
      initial_prompt:initialPrompt,
    });
    const state=await this.#loadState();
    state.bindings[learner]={
      learner,
      project_id:result.project_id,
      project_url:result.project_url,
      thread_url:result.thread_url,
      target_id:null,
    };
    await this.#saveState(state);
    return {...result,target_id:null};
  }

  resetThread(args){ return this.setup(args); }

  async turn({learner,prompt,attachments=[]}){
    const state=await this.#loadState();
    const binding=state.bindings[learner];
    if(!binding?.thread_url) throw new Error(`No browser-workspace Tutor binding for learner ${learner}`);
    const staged=await this.#stageAttachments(attachments);
    try{
      const result=await this.#runAction('thread-turn',{
        thread_url:binding.thread_url,
        prompt,
        file:staged.map(item=>item.path),
        result_timeout:240,
      },{url:binding.thread_url});
      state.bindings[learner]={...binding,thread_url:result.thread_url||binding.thread_url,target_id:null};
      await this.#saveState(state);
      return {...result,target_id:null};
    }finally{
      await Promise.allSettled(staged.map(item=>fsp.rm(item.path,{force:true})));
      if(staged.length) await fsp.rm(staged[0].dir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async #runAction(action,config,{url=null}={}){
    if(!fs.existsSync(this.cli)) throw new Error(`browser-workspace CLI not installed: ${this.cli}`);
    const filename=action==='project-setup'?'_project_setup.py':action==='thread-turn'?'_thread_turn.py':null;
    if(!filename) throw new Error(`Unsupported ChatGPT action: ${action}`);
    const actionPath=path.join(this.actionsDir,filename);
    if(!fs.existsSync(actionPath)) throw new Error(`browser-workspace ChatGPT action missing: ${actionPath}`);

    await fsp.mkdir(path.join(this.stateDir,'tmp'),{recursive:true,mode:0o700});
    const tempDir=await fsp.mkdtemp(path.join(this.stateDir,'tmp',`${action}-`));
    const configPath=path.join(tempDir,'config.json');
    const actionConfig={...config};
    await fsp.writeFile(configPath,JSON.stringify(actionConfig),{mode:0o600});
    let sessionId=null;
    try{
      const startArgs=['session','start','--workspace',this.workspace];
      if(url) startArgs.push('--url',url);
      const started=parseJSONLine((await this.run(this.cli,startArgs,{timeoutMs:60000})).stdout,'browser-workspace session start');
      if(started.error) throw new Error(started.error);
      sessionId=started.session_id;
      if(!sessionId) throw new Error('browser-workspace session start returned no session_id');
      if(action==='thread-turn' && started.target_id){
        actionConfig.target_id=started.target_id;
        await fsp.writeFile(configPath,JSON.stringify(actionConfig),{mode:0o600});
      }

      let source=await fsp.readFile(actionPath,'utf8');
      const actionDir=path.dirname(actionPath);
      source=`import sys\nsys.path.insert(0, ${JSON.stringify(actionDir)})\n${source}`;
      source=source.replaceAll('__CFG_PATH__',configPath.replaceAll('\\','\\\\').replaceAll('"','\\"'));
      const execResult=parseJSONLine((await this.run(this.cli,['session','exec',sessionId],{input:source,timeoutMs:360000})).stdout,'browser-workspace session exec');
      if(!execResult.ok) throw new Error(execResult.error||execResult.stderr||'browser-workspace action failed');
      return parseJSONLine(execResult.stdout,`ChatGPT ${action}`);
    }finally{
      if(sessionId){
        await this.run(this.cli,['session','stop',sessionId],{timeoutMs:30000}).catch(()=>{});
      }
      await fsp.rm(tempDir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async #loadState(){
    try{
      const parsed=JSON.parse(await fsp.readFile(this.bindingsFile,'utf8'));
      return {version:1,bindings:parsed?.bindings&&typeof parsed.bindings==='object'?parsed.bindings:{}};
    }catch(error){
      if(error?.code!=='ENOENT') throw error;
      return {version:1,bindings:{}};
    }
  }

  async #saveState(state){
    await fsp.mkdir(this.stateDir,{recursive:true,mode:0o700});
    const temp=`${this.bindingsFile}.tmp-${process.pid}`;
    await fsp.writeFile(temp,JSON.stringify({version:1,bindings:state.bindings},null,2)+'\n',{mode:0o600});
    await fsp.rename(temp,this.bindingsFile);
  }

  async #stageAttachments(attachments){
    if(!attachments.length) return [];
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
