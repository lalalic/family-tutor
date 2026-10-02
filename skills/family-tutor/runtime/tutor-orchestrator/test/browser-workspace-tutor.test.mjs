import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWorkspaceTutorClient } from '../src/browser-workspace-tutor.mjs';

async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ft-bw-skill-'));
  const instance=await fs.mkdtemp(path.join(os.tmpdir(),'ft-bw-instance-'));
  await fs.mkdir(path.join(root,'bin'),{recursive:true});
  await fs.mkdir(path.join(root,'platforms','chatgpt','actions'),{recursive:true});
  await fs.writeFile(path.join(root,'bin','browser-workspace'),'#!/bin/sh\n');
  await fs.chmod(path.join(root,'bin','browser-workspace'),0o755);
  await fs.writeFile(path.join(root,'platforms','chatgpt','actions','_project_setup.py'),'print("__CFG_PATH__")\n');
  await fs.writeFile(path.join(root,'platforms','chatgpt','actions','_thread_turn.py'),'print("__CFG_PATH__")\n');
  return {root,instance};
}

function fakeRun(sequence,calls){
  return async(command,args,options={})=>{
    const call={command,args,input:options.input||''};
    if(args?.[0]==='session'&&args?.[1]==='exec'){
      const configPath=call.input.match(/print\(\"([^\"]+config\.json)\"\)/)?.[1];
      if(configPath) call.config=JSON.parse(await fs.readFile(configPath,'utf8'));
    }
    calls.push(call);
    const next=sequence.shift();
    if(!next) throw new Error('unexpected browser-workspace invocation');
    return {stdout:JSON.stringify(next)+'\n',stderr:''};
  };
}

test('BrowserWorkspaceTutorClient setup persists learner binding and releases session',async()=>{
  const {root,instance}=await fixture();
  const calls=[];
  const run=fakeRun([
    {session_id:'s1',workspace:'Tutor'},
    {ok:true,stdout:JSON.stringify({status:'completed',project_id:'p1',project_url:'https://chatgpt.com/g/p1/project',thread_url:'https://chatgpt.com/c/t1'})+'\n',stderr:''},
    {session_id:'s1',closed_tabs:2},
  ],calls);
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run});
  const result=await client.setup({learner:'maggie',projectName:'Maggie',instructions:'Teach well'});
  assert.equal(result.thread_url,'https://chatgpt.com/c/t1');
  assert.equal(calls[0].args.join(' '),'session start --workspace Tutor');
  assert.equal(calls[1].args.join(' '),'session exec s1');
  assert.equal(calls[1].config.instructions,'Teach well');
  assert.equal(calls[2].args.join(' '),'session stop s1');
  const status=await client.status();
  assert.equal(status.bindings[0].learner,'maggie');
  assert.equal(status.bindings[0].thread_url,'https://chatgpt.com/c/t1');
});

test('BrowserWorkspaceTutorClient turn reuses durable thread url and updates binding',async()=>{
  const {root,instance}=await fixture();
  const setupCalls=[];
  const setupRun=fakeRun([
    {session_id:'s1',workspace:'Tutor'},
    {ok:true,stdout:JSON.stringify({status:'completed',project_id:'p1',project_url:'https://chatgpt.com/g/p1/project',thread_url:'https://chatgpt.com/c/t1'})+'\n',stderr:''},
    {session_id:'s1',closed_tabs:1},
  ],setupCalls);
  const setupClient=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run:setupRun});
  await setupClient.setup({learner:'maggie',projectName:'Maggie',instructions:'x'});

  const calls=[];
  const run=fakeRun([
    {session_id:'s2',workspace:'Tutor',target_id:'target-thread'},
    {ok:true,stdout:JSON.stringify({status:'completed',thread_url:'https://chatgpt.com/c/t1',text:'Hello Maggie'})+'\n',stderr:''},
    {session_id:'s2',closed_tabs:1},
  ],calls);
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run});
  const result=await client.turn({learner:'maggie',prompt:'2+2?'});
  assert.equal(result.text,'Hello Maggie');
  assert.deepEqual(calls[0].args,['session','start','--workspace','Tutor','--url','https://chatgpt.com/c/t1']);
  assert.equal(calls[1].config.prompt,'2+2?');
  assert.equal(calls[1].config.target_id,'target-thread');
});

test('BrowserWorkspaceTutorClient rejects turn without binding',async()=>{
  const {root,instance}=await fixture();
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run:async()=>{throw new Error('should not run')}});
  await assert.rejects(()=>client.turn({learner:'unknown',prompt:'hi'}),/No browser-workspace Tutor binding/);
});
