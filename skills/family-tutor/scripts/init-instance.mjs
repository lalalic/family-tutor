#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)); const skill=path.dirname(here); const target=path.resolve(process.argv[2]||path.join('family-tutor','runs','family'));
fs.mkdirSync(path.join(target,'config'),{recursive:true});
for(const [src,dest] of [[path.join(skill,'templates','family.config.json'),path.join(target,'config','family.config.json')],[path.join(skill,'templates','AGENTS.md'),path.join(target,'AGENTS.md')]]) if(!fs.existsSync(dest)) fs.copyFileSync(src,dest);
const ignore=path.join(target,'.gitignore'); if(!fs.existsSync(ignore)) fs.writeFileSync(ignore,'.env\n'); console.log(target);
