import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.mjs';

async function writeConfig(value){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-config-'));
  const file=path.join(dir,'family.json');
  await fs.writeFile(file,JSON.stringify(value));
  return {dir,file};
}

function base(){
  return {
    version:1,
    codex:{backend:'codex'},
    discord:{parentChannelId:'parent'},
    children:[{id:'sammy',name:'Sammy'}],
  };
}

test('migrates obsolete neoyTutor config to Browser Workspace Tutor',async()=>{
  const {dir,file}=await writeConfig({...base(),neoyTutor:{enabled:true,url:'http://127.0.0.1:6767/mcp'}});
  const cfg=loadConfig(file);
  assert.equal(cfg.browserWorkspace.enabled,true);
  assert.equal(cfg.browserWorkspace.workspace,'Tutor');
  assert.equal(cfg.neoyTutor,undefined);
  await fs.rm(dir,{recursive:true,force:true});
});

test('continues to accept explicit legacy browserBridge config',async()=>{
  const {dir,file}=await writeConfig({...base(),browserBridge:{enabled:true,host:'127.0.0.1',port:43117}});
  const cfg=loadConfig(file);
  assert.equal(cfg.browserBridge.enabled,true);
  await fs.rm(dir,{recursive:true,force:true});
});

test('accepts Browser Workspace Tutor config and defaults workspace',async()=>{
  const {file}=await writeConfig({...base(),browserWorkspace:{enabled:true}});
  const cfg=loadConfig(file);
  assert.equal(cfg.browserWorkspace.enabled,true);
  assert.equal(cfg.browserWorkspace.workspace,'Tutor');
});

test('rejects blank Browser Workspace Tutor workspace',async()=>{
  const {file}=await writeConfig({...base(),browserWorkspace:{enabled:true,workspace:'   '}});
  assert.throws(()=>loadConfig(file),/browserWorkspace\.workspace must be non-empty/);
});

test('defaults Discord transport to Cloudflare serverless',async()=>{
  const {dir,file}=await writeConfig(base());
  const cfg=loadConfig(file);
  assert.equal(cfg.discord.mode,'cloudflare');
  await fs.rm(dir,{recursive:true,force:true});
});

test('accepts explicit local Discord transport',async()=>{
  const value=base(); value.discord={...(value.discord||{}),mode:'local'};
  const {dir,file}=await writeConfig(value);
  const cfg=loadConfig(file);
  assert.equal(cfg.discord.mode,'local');
  await fs.rm(dir,{recursive:true,force:true});
});

test('rejects unknown Discord transport',async()=>{
  const value=base(); value.discord={...(value.discord||{}),mode:'socket'};
  const {dir,file}=await writeConfig(value);
  assert.throws(()=>loadConfig(file),/discord\.mode must be local or cloudflare/);
  await fs.rm(dir,{recursive:true,force:true});
});
