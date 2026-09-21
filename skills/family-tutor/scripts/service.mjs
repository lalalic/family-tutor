#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const action=process.argv[2]||'status';
const instance=path.resolve(process.argv[3]||process.cwd());
const configFile=path.join(instance,'config','family.config.json');
if(!fs.existsSync(configFile)) throw new Error(`Missing config: ${configFile}`);
const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));
const name=cfg.serviceName||'family-tutor-orchestrator';
const here=path.dirname(fileURLToPath(import.meta.url));
const runtime=path.join(path.dirname(here),'runtime','tutor-orchestrator');
const serviceEnv={...process.env,FAMILY_TUTOR_CONFIG:configFile};
if(!fs.existsSync(path.join(runtime,'node_modules','discord.js'))){
  const install=spawnSync('npm',['install','--omit=dev','--no-fund','--no-audit'],{cwd:runtime,stdio:'inherit',env:process.env});
  if(install.status) process.exit(install.status);
}
function run(args){const r=spawnSync('npx',['--yes','pm2',...args],{stdio:'inherit',env:serviceEnv}); if(r.status) process.exit(r.status);}

if(action==='start'){
  run(['start',path.join(runtime,'src','index.mjs'),'--name',name,'--namespace','family-tutor','--cwd',runtime,'--update-env']);
  run(['save']);
}else if(action==='restart'){
  run(['restart',name,'--update-env']);
  run(['save']);
}else if(action==='stop') run(['stop',name]);
else if(action==='status') run(['describe',name]);
else if(action==='logs') run(['logs',name,'--lines','200','--nostream']);
else throw new Error(`Unknown action: ${action}`);
