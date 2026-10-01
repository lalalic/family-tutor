import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NeoYTutorClient } from '../src/neoy-tutor.mjs';

function jsonResponse(object,{status=200}={}){
  return {
    ok:status>=200&&status<300,
    status,
    async json(){return object;},
  };
}

test('NeoYTutorClient calls fixed tutor.workspace MCP surface',async()=>{
  const calls=[];
  const client=new NeoYTutorClient({
    url:'http://127.0.0.1:6767/mcp',
    instanceDir:await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-neoy-')),
    fetchImpl:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      return jsonResponse({
        jsonrpc:'2.0',
        id:'x',
        result:{isError:false,content:[{type:'text',text:JSON.stringify({feature:'tutor',bindings:[]})}]},
      });
    },
  });
  const result=await client.status();
  assert.equal(result.feature,'tutor');
  assert.equal(calls[0].body.params.name,'tutor.workspace');
  assert.deepEqual(calls[0].body.params.arguments,{action:'status'});
});

test('NeoYTutorClient stages remote attachment only for the turn then removes it',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-neoy-'));
  const calls=[];
  const client=new NeoYTutorClient({
    instanceDir:root,
    fetchImpl:async(url,options)=>{
      if(String(url).startsWith('https://cdn.example/')){
        return {ok:true,status:200,async arrayBuffer(){return Buffer.from('image-bytes')}};
      }
      const body=JSON.parse(options.body);
      calls.push(body);
      return jsonResponse({
        jsonrpc:'2.0',
        id:body.id,
        result:{isError:false,content:[{type:'text',text:JSON.stringify({
          status:'completed',thread_url:'https://chatgpt.com/c/1',target_id:'t1',
          recovered:false,text:'answer'
        })}]},
      });
    },
  });
  const result=await client.turn({
    learner:'maggie',
    prompt:'help',
    attachments:[{url:'https://cdn.example/a.png',name:'a.png',size:11}],
  });
  assert.equal(result.text,'answer');
  const args=calls[0].params.arguments;
  assert.equal(args.action,'turn');
  assert.equal(args.learner,'maggie');
  assert.equal(args.files.length,1);
  await assert.rejects(fs.stat(args.files[0]));
  await fs.rm(root,{recursive:true,force:true});
});

test('NeoYTutorClient surfaces MCP tool errors',async()=>{
  const client=new NeoYTutorClient({
    instanceDir:os.tmpdir(),
    fetchImpl:async()=>jsonResponse({
      jsonrpc:'2.0',id:'x',
      result:{isError:true,content:[{type:'text',text:'Error: learner not bound'}]},
    }),
  });
  await assert.rejects(client.status(),/learner not bound/);
});


test('NeoYTutorClient setup sends project bootstrap fields',async()=>{
  const calls=[];
  const client=new NeoYTutorClient({
    instanceDir:os.tmpdir(),
    fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);
      calls.push(body.params.arguments);
      return jsonResponse({
        jsonrpc:'2.0',id:body.id,
        result:{isError:false,content:[{type:'text',text:JSON.stringify({
          status:'completed',
          learner:'maggie',
          project_id:'g-p-12345678901234567890123456789012',
          project_url:'https://chatgpt.com/g/g-p-12345678901234567890123456789012/project',
          project_reused:true,
          memory:'project-only',
          thread_url:'https://chatgpt.com/g/g-p-12345678901234567890123456789012/c/thread',
          target_id:'target-1'
        })}]},
      });
    },
  });
  const result=await client.setup({
    learner:'maggie',
    projectName:'Maggie',
    instructions:'Tutor instructions',
    initialPrompt:'Initialize Maggie',
  });
  assert.equal(result.project_reused,true);
  assert.deepEqual(calls[0],{
    action:'setup',
    learner:'maggie',
    project_name:'Maggie',
    instructions:'Tutor instructions',
    initial_prompt:'Initialize Maggie',
  });
});

test('NeoYTutorClient resetThread reuses setup contract',async()=>{
  let args=null;
  const client=new NeoYTutorClient({
    instanceDir:os.tmpdir(),
    fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body); args=body.params.arguments;
      return jsonResponse({jsonrpc:'2.0',id:body.id,result:{isError:false,content:[{type:'text',text:JSON.stringify({status:'completed'})}]}});
    },
  });
  await client.resetThread({learner:'sammy',projectName:'Sammy',instructions:'i'});
  assert.equal(args.action,'reset_thread');
  assert.equal(args.project_name,'Sammy');
});
