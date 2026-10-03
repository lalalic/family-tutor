#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const instanceDir=path.resolve(process.argv[2]||'');
const raw=process.argv[3]||'';
if(!instanceDir||!raw){ console.error('usage: configure.mjs <instance-dir> <json-object-patch>'); process.exit(64); }
let patch;
try{ patch=JSON.parse(raw); }catch{ console.error('configuration patch must be valid JSON'); process.exit(64); }
if(!patch||Array.isArray(patch)||typeof patch!=='object'){ console.error('configuration patch must be a JSON object'); process.exit(64); }
const allowed=new Set(['serviceName','children','discord','browserBridge','browserWorkspace']);
for(const key of Object.keys(patch)) if(!allowed.has(key)){ console.error(`unsupported Family Tutor configuration field: ${key}`); process.exit(64); }
if(patch.children!==undefined){
  if(!Array.isArray(patch.children)||patch.children.length===0){ console.error('children must be a non-empty array'); process.exit(64); }
  const seen=new Set();
  for(const child of patch.children){
    const id=String(child?.id||'').trim(); const name=String(child?.name||'').trim();
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)||!name){ console.error('each child requires a canonical lowercase id and non-empty name'); process.exit(64); }
    if(seen.has(id)){ console.error(`duplicate child id: ${id}`); process.exit(64); } seen.add(id);
  }
}
if(patch.browserBridge?.host!==undefined && !['127.0.0.1','localhost','::1'].includes(String(patch.browserBridge.host))){
  console.error('Family Tutor browserBridge.host must be loopback'); process.exit(64);
}
if(patch.browserBridge?.port!==undefined){ const p=Number(patch.browserBridge.port); if(!Number.isInteger(p)||p<1||p>65535){ console.error('browserBridge.port must be 1..65535'); process.exit(64); } }
if(patch.discord?.mode!==undefined && !['cloudflare','local'].includes(String(patch.discord.mode))){ console.error('discord.mode must be cloudflare or local'); process.exit(64); }
const configPath=path.join(instanceDir,'config','family.config.json');
if(!fs.existsSync(configPath)){ console.error(`Family Tutor config not found: ${configPath}`); process.exit(66); }
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const merge=(base,value)=>{
  if(!value||Array.isArray(value)||typeof value!=='object') return value;
  const out={...(base&&typeof base==='object'&&!Array.isArray(base)?base:{})};
  for(const [k,v] of Object.entries(value)) out[k]=merge(out[k],v);
  return out;
};
for(const [key,value] of Object.entries(patch)) config[key]=merge(config[key],value);
fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({ok:true,configured:Object.keys(patch).sort(),config:configPath}));
