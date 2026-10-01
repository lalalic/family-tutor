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

test('accepts loopback NeoY Tutor MCP config',async()=>{
  const {dir,file}=await writeConfig({...base(),neoyTutor:{enabled:true,url:'http://127.0.0.1:6767/mcp'}});
  const cfg=loadConfig(file);
  assert.equal(cfg.neoyTutor.enabled,true);
  await fs.rm(dir,{recursive:true,force:true});
});

test('rejects non-loopback NeoY Tutor MCP config',async()=>{
  const {dir,file}=await writeConfig({...base(),neoyTutor:{enabled:true,url:'https://example.com/mcp'}});
  assert.throws(()=>loadConfig(file),/loopback/);
  await fs.rm(dir,{recursive:true,force:true});
});

test('continues to accept explicit legacy browserBridge config',async()=>{
  const {dir,file}=await writeConfig({...base(),browserBridge:{enabled:true,host:'127.0.0.1',port:43117}});
  const cfg=loadConfig(file);
  assert.equal(cfg.browserBridge.enabled,true);
  await fs.rm(dir,{recursive:true,force:true});
});
