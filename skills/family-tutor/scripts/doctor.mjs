#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const instance=path.resolve(process.argv[2]||process.cwd());
const configPath=path.join(instance,'config','family.config.json');
let failed=false;
function check(ok,msg){console.log(`${ok?'✓':'✗'} ${msg}`); if(!ok) failed=true;}

check(fs.existsSync(configPath),`config exists: ${configPath}`);
let cfg=null;
if(fs.existsSync(configPath)){
  try{
    cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
    check(Array.isArray(cfg.children)&&cfg.children.length>0,'at least one child is configured');
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>c.id&&c.name),'every child has canonical id and name');
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>!Object.keys(c).some(key=>/project|tab|discordChannelId/i.test(key))),'children keep no browser/provider bindings');
    check(Boolean(cfg.discord?.parentChannelId),'parent channel id is configured');
    check(cfg.browserBridge?.enabled===true,'loopback Family Tutor MCP bridge is enabled');
    check(['127.0.0.1','localhost','::1'].includes(String(cfg.browserBridge?.host||'127.0.0.1')),'Family Tutor MCP bridge host is loopback');
    if((cfg.discord?.mode||'cloudflare')==='local') check(Boolean(process.env.DISCORD_BOT_TOKEN),'DISCORD_BOT_TOKEN is exported for local Discord mode');
    else check(true,'Discord transport is managed by Cloudflare');
  }catch(error){
    check(false,`config parses: ${error.message}`);
  }
}

if(cfg?.browserWorkspace?.enabled||cfg?.neoyTutor?.enabled){
  const cli=path.join(process.env.HOME||'', '.agents','skills','browser-workspace','bin','browser-workspace');
  check(fs.existsSync(cli),'browser-workspace skill is installed');
  if(fs.existsSync(cli)){
    const help=spawnSync(cli,['--help'],{encoding:'utf8',timeout:10000});
    check(help.status===0,'browser-workspace CLI is runnable');
    const workspace=String(cfg.browserWorkspace?.workspace||'Tutor');
    const started=spawnSync(cli,['session','start','--workspace',workspace],{encoding:'utf8',timeout:30000});
    let sessionId=null;
    if(started.status===0){
      try{ sessionId=JSON.parse(started.stdout.trim()).session_id||null; }catch{}
    }
    check(started.status===0&&Boolean(sessionId),`browser-workspace ${workspace} session can start`);
    if(sessionId) spawnSync(cli,['session','stop',sessionId],{encoding:'utf8',timeout:30000});
    const root=path.resolve(path.dirname(cli),'..');
    check(fs.existsSync(path.join(root,'platforms','chatgpt','actions','_project_setup.py')),'ChatGPT project-setup action is installed');
    check(fs.existsSync(path.join(root,'platforms','chatgpt','actions','_thread_turn.py')),'ChatGPT thread-turn action is installed');
  }
}else{
  const executable=spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000});
  check(executable.status===0,'Codex executable is available for legacy/local fallback');
  const login=spawnSync('codex',['login','status'],{encoding:'utf8',timeout:5000});
  const loginOutput=`${login.stdout||''}\n${login.stderr||''}`;
  check(login.status===0 && /logged in using|already logged in|authenticated/i.test(loginOutput),'Codex login is active');
}

process.exitCode=failed?1:0;
