import fs from 'node:fs/promises';
import path from 'node:path';

function sanitizeName(value='attachment'){
  return String(value).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)||'attachment';
}

function toolText(payload){
  if(payload?.error) throw new Error(payload.error.message||'NeoY MCP request failed');
  const result=payload?.result;
  if(result?.isError) throw new Error(result.content?.[0]?.text||'NeoY tutor tool failed');
  const text=result?.content?.find?.(item=>item?.type==='text')?.text;
  if(typeof text!=='string') throw new Error('NeoY tutor tool returned no text result');
  return text;
}

export class NeoYTutorClient {
  constructor({url='http://127.0.0.1:6767/mcp',instanceDir,fetchImpl=fetch}={}){
    this.url=url;
    this.instanceDir=instanceDir;
    this.fetch=fetchImpl;
    this.requestId=0;
  }

  async #call(argumentsObject){
    const response=await this.fetch(this.url,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        jsonrpc:'2.0',
        id:`family-tutor-${++this.requestId}`,
        method:'tools/call',
        params:{name:'tutor.workspace',arguments:argumentsObject},
      }),
    });
    const body=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(body?.error?.message||`NeoY MCP HTTP ${response.status}`);
    return JSON.parse(toolText(body));
  }

  status(){ return this.#call({action:'status'}); }

  bind({learner,threadUrl}){
    return this.#call({action:'bind',learner,thread_url:threadUrl});
  }

  unbind({learner}){
    return this.#call({action:'unbind',learner});
  }

  setup({learner,projectName,instructions,initialPrompt=''}){
    return this.#call({
      action:'setup',
      learner,
      project_name:projectName,
      instructions,
      initial_prompt:initialPrompt,
    });
  }


  resetThread({learner,projectName,instructions,initialPrompt=''}){
    return this.#call({
      action:'reset_thread',
      learner,
      project_name:projectName,
      instructions,
      initial_prompt:initialPrompt,
    });
  }

  async turn({learner,prompt,attachments=[]}){
    const staged=await this.#stageAttachments(attachments);
    try{
      return await this.#call({
        action:'turn',
        learner,
        prompt,
        files:staged.map(item=>item.path),
      });
    }finally{
      await Promise.allSettled(staged.map(item=>fs.rm(item.path,{force:true})));
      if(staged.length) await fs.rm(staged[0].dir,{recursive:true,force:true}).catch(()=>{});
    }
  }

  async #stageAttachments(attachments){
    if(!attachments.length) return [];
    if(!this.instanceDir) throw new Error('NeoY attachment staging requires instanceDir');
    const dir=path.join(this.instanceDir,'.neoy-tutor-tmp',`${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`);
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const staged=[];
    try{
      for(const [index,attachment] of attachments.slice(0,4).entries()){
        if(!attachment?.url) continue;
        const response=await this.fetch(attachment.url);
        if(!response.ok) throw new Error(`attachment download failed: HTTP ${response.status}`);
        const declared=Number(attachment.size||0);
        if(declared>25*1024*1024) throw new Error('attachment exceeds 25 MB NeoY tutor limit');
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>25*1024*1024) throw new Error('attachment exceeds 25 MB NeoY tutor limit');
        const name=`${index+1}-${sanitizeName(attachment.name)}`;
        const localPath=path.join(dir,name);
        await fs.writeFile(localPath,bytes,{mode:0o600});
        staged.push({path:localPath,dir});
      }
      return staged;
    }catch(error){
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }
}
