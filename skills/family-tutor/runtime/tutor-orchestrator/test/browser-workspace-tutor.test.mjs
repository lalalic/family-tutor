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
  await fs.writeFile(path.join(root,'bin','browser-workspace'),'#!/bin/sh\n');
  await fs.chmod(path.join(root,'bin','browser-workspace'),0o755);
  return {root,instance};
}
function runner(handler,calls){ return async(command,args)=>{ calls.push({command,args}); return {stdout:JSON.stringify(await handler(args))+'\n',stderr:''}; }; }
function platformResult(payload){ return {platform:'chatgpt',result:{ok:true,stdout:JSON.stringify(payload)+'\n',stderr:''}}; }

test('setup persists only project and thread ids',async()=>{
  const {root,instance}=await fixture(); const calls=[];
  const run=runner(async args=>platformResult({status:'completed',project_id:'p1',thread_id:'t1',thread_url:'https://chatgpt.com/g/p1/c/t1'}),calls);
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run});
  const result=await client.setup({learner:'maggie',projectName:'Maggie',instructions:'Teach well'});
  assert.equal(result.thread_id,'t1');
  const persisted=JSON.parse(await fs.readFile(path.join(instance,'.family-tutor','browser-workspace-bindings.json'),'utf8'));
  assert.deepEqual(persisted,{version:2,bindings:{maggie:{learner:'maggie',project_id:'p1',thread_id:'t1'}}});
  assert.deepEqual(calls[0].args.slice(0,4),['platform','run','chatgpt','project-setup']);
});

test('service owns learner sessions and submit reuses session',async()=>{
  const {root,instance}=await fixture();
  await fs.mkdir(path.join(instance,'.family-tutor'),{recursive:true});
  await fs.writeFile(path.join(instance,'.family-tutor','browser-workspace-bindings.json'),JSON.stringify({version:2,bindings:{maggie:{learner:'maggie',project_id:'p1',thread_id:'t1'}}}));
  const calls=[];
  const adminCalls=[];
  const helperPath=path.join(root,'node','admin.mjs');
  const run=runner(async args=>{
    if(args[0]==='status') return {admin_helper:helperPath,daemon:{running:true}};
    if(args[0]==='session'&&args[1]==='start') return {session_id:'kid-session',target_id:'kid-tab'};
    if(args[0]==='platform') return platformResult({status:'submitted',project_id:'p1',thread_id:'t1'});
    if(args[0]==='session'&&args[1]==='stop') return {closed_tabs:1};
    throw new Error(`unexpected ${args.join(' ')}`);
  },calls);
  const loadAdmin=async value=>{
    assert.equal(value,helperPath);
    return {
      ensureWorkspace:async(name,size)=>adminCalls.push({op:'ensure',name,size}),
      deleteWorkspace:async(name,options)=>adminCalls.push({op:'delete',name,options}),
    };
  };
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run,loadAdmin});
  await client.start();
  await client.submit({learner:'maggie',prompt:'hi'});
  const submit=calls.find(call=>call.args[0]==='platform');
  assert.ok(submit.args.includes('--session-id'));
  assert.equal(submit.args[submit.args.indexOf('--session-id')+1],'kid-session');
  assert.equal(calls.filter(call=>call.args[0]==='session'&&call.args[1]==='start').length,1);
  assert.deepEqual(adminCalls[0],{op:'ensure',name:'Tutor',size:5});
  assert.deepEqual(calls[0].args,['status']);
  await client.stop();
  assert.deepEqual(adminCalls[1],{op:'delete',name:'Tutor',options:{force:true}});
  assert.equal(calls.some(call=>call.args[0]==='workspace'),false);
});

test('legacy URL binding migrates to version 2 IDs',async()=>{
  const {root,instance}=await fixture();
  await fs.mkdir(path.join(instance,'.family-tutor'),{recursive:true});
  await fs.writeFile(path.join(instance,'.family-tutor','browser-workspace-bindings.json'),JSON.stringify({version:1,bindings:{maggie:{learner:'maggie',project_id:'p1',thread_url:'https://chatgpt.com/g/p1-maggie/c/t-old',target_id:null}}}));
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,skillRoot:root,run:async()=>{throw new Error('should not run')}});
  const status=await client.status();
  assert.equal(status.bindings[0].thread_id,'t-old');
  const persisted=JSON.parse(await fs.readFile(path.join(instance,'.family-tutor','browser-workspace-bindings.json'),'utf8'));
  assert.equal(persisted.version,2); assert.equal(persisted.bindings.maggie.thread_id,'t-old'); assert.equal(persisted.bindings.maggie.thread_url,undefined);
});


test('default runtime discovers Browser Workspace admin helper through status without lifecycle CLI',async()=>{
  const instance=await fs.mkdtemp(path.join(os.tmpdir(),'ft-bw-instance-'));
  const calls=[]; const adminCalls=[];
  const run=runner(async args=>{
    if(args[0]==='status') return {admin_helper:'/tmp/browser-workspace-admin.mjs'};
    throw new Error(`unexpected ${args.join(' ')}`);
  },calls);
  const client=new BrowserWorkspaceTutorClient({instanceDir:instance,browserWorkspaceCommand:'browser-workspace',run,loadAdmin:async()=>({
    ensureWorkspace:async(name,size)=>adminCalls.push({name,size}),
    deleteWorkspace:async()=>{},
  })});
  await client.start();
  assert.equal(calls[0].command,'browser-workspace');
  assert.deepEqual(calls[0].args,['status']);
  assert.deepEqual(adminCalls,[{name:'Tutor',size:5}]);
  await client.stop();
});
