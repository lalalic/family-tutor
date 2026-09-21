import fs from 'node:fs';
import path from 'node:path';
function nonEmpty(v){ return typeof v === 'string' && v.trim() !== ''; }
export function loadConfig(file){
  const configPath=path.resolve(file);
  const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(cfg.version!==1) throw new Error(`Unsupported config version: ${cfg.version}`);
  if(!Array.isArray(cfg.children)||cfg.children.length===0) throw new Error('children must be a non-empty array');
  if(!nonEmpty(cfg.discord?.parentChannelId)) throw new Error('discord.parentChannelId is required');
  if(cfg.codex?.backend!=='codex') throw new Error(`Unsupported codex backend: ${cfg.codex?.backend}`);
  if(cfg.browserBridge?.enabled){
    const host=cfg.browserBridge.host||'127.0.0.1';
    if(!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('browserBridge.host must be loopback');
    const port=Number(cfg.browserBridge.port||43117);
    if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('browserBridge.port must be between 1024 and 65535');
  }
  const ids=new Set();
  for(const child of cfg.children){
    if(!nonEmpty(child.id)||!nonEmpty(child.name)) throw new Error('each child requires canonical id (the Discord channel name) and name');
    if(ids.has(child.id)) throw new Error(`duplicate child id: ${child.id}`);
    if(Object.keys(child).some(key=>['alias','aliases','channelId','discordChannelId','project','projectId','tabId'].includes(key))) throw new Error(`child ${child.id} must use its Discord channel name as the sole routing key`);
    ids.add(child.id);
  }
  return {...cfg,configPath};
}
