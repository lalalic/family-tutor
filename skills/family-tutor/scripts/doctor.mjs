#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const instance=path.resolve(process.argv[2]||process.cwd());
const config=path.join(instance,'config','family.config.json');
let failed=false;
function check(ok,msg){console.log(`${ok?'✓':'✗'} ${msg}`); if(!ok) failed=true;}
check(fs.existsSync(config),`config exists: ${config}`);
check(Boolean(process.env.DISCORD_BOT_TOKEN),'DISCORD_BOT_TOKEN is exported');
const executable=spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000});
check(executable.status===0,'codex executable is available');
const login=spawnSync('codex',['login','status'],{encoding:'utf8',timeout:5000});
const loginOutput=`${login.stdout||''}\n${login.stderr||''}`;
check(login.status===0 && /logged in using|already logged in|authenticated/i.test(loginOutput),'Codex login is active');
if(fs.existsSync(config)){
  try{
    const cfg=JSON.parse(fs.readFileSync(config,'utf8'));
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>c.discordChannelId),'every child has a Discord channel id');
    check(cfg.codex?.backend==='codex','Codex backend is configured');
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>!Object.keys(c).some(key=>/project|tab/i.test(key))),'children have no browser bindings');
    check(Boolean(cfg.discord?.parentChannelId),'parent channel id is configured');
  }catch(e){check(false,`config parses: ${e.message}`)}
}
process.exitCode=failed?1:0;
