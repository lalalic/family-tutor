import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonl, prepareAttachments, buildTutorPrompt, buildCodexArgv, CodexBackend } from '../src/backends/codex.mjs';
import { buildKidContext } from '../src/runtime-context.mjs';

test('builds safe Codex argv for new/resumed text and image turns',()=>{
  const base=['exec','--json','--sandbox','read-only','--skip-git-repo-check','-C','/instance/sammy'];
  assert.deepEqual(buildCodexArgv({childDir:'/instance/sammy'}),base);
  assert.deepEqual(buildCodexArgv({childDir:'/instance/sammy',threadId:'t1'}),[...base,'resume','t1']);
  assert.deepEqual(buildCodexArgv({childDir:'/instance/sammy',model:'local-model',imageFiles:['/tmp/a.png']}),[...base,'--model','local-model','--image','/tmp/a.png']);
  assert.deepEqual(buildCodexArgv({childDir:'/instance/sammy',threadId:'t1',imageFiles:['/tmp/a.png']}),[...base,'resume','t1','--image','/tmp/a.png']);
});

test('parses Codex JSONL thread and assistant message events',()=>{
  const parsed=parseJsonl([
    JSON.stringify({type:'thread.started',thread_id:'thread-a'}),
    JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'hello tutor'}}),
    'not json',
  ].join('\n'));
  assert.equal(parsed.threadId,'thread-a');
  assert.equal(parsed.text,'hello tutor');
});

test('persists one thread per child and rollover clears only that child',async()=>{
  const instance=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-test-'));
  const backend=new CodexBackend({}, {instanceDir:instance});
  fs.mkdirSync(path.join(instance,'sammy'),{recursive:true});
  fs.mkdirSync(path.join(instance,'config','sammy'),{recursive:true});
  fs.writeFileSync(path.join(instance,'sammy','AGENTS.md'),'real learner memory');
  fs.writeFileSync(path.join(instance,'config','sammy','AGENTS.md'),'wrong config memory');
  assert.equal(backend.memoryFile('sammy'),path.join(instance,'sammy','AGENTS.md'));
  backend.writeThread('sammy','thread-s'); backend.writeThread('maggie','thread-m');
  assert.equal(backend.readThread('sammy'),'thread-s');
  assert.equal(fs.readFileSync(backend.memoryFile('sammy'),'utf8'),'real learner memory');
  await backend.newThread({childId:'sammy'});
  assert.equal(backend.readThread('sammy'),null);
  assert.equal(backend.readThread('maggie'),'thread-m');
  fs.rmSync(instance,{recursive:true,force:true});
});

test('prepares non-image attachments and keeps Codex cwd child-scoped',async()=>{
  const instance=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-test-'));
  const backend=new CodexBackend({}, {instanceDir:instance});
  const childDir=path.join(instance,'sammy'); fs.mkdirSync(childDir,{recursive:true});
  const prepared=await prepareAttachments([{url:'data:text/plain,hello',name:'notes.txt',mimeType:'text/plain'}],'sammy',childDir);
  assert.equal(backend.childDir('sammy'),path.join(instance,'sammy'));
  assert.equal(prepared.descriptions[0].mimeType,'text/plain');
  assert.match(prepared.descriptions[0].path,new RegExp(`${childDir}/\\.family-tutor-attachments-`));
  assert.equal(fs.readFileSync(prepared.files[0],'utf8'),'hello');
  const prompt=buildTutorPrompt(buildKidContext({childId:'sammy',text:'help'}),prepared.descriptions);
  assert.match(prompt,/FAMILY_TUTOR_CONTEXT/); assert.match(prompt,/"type":"kid"/); assert.match(prompt,/notes\.txt/); assert.doesNotMatch(prompt,/Teach with hints|FAMILY_TUTOR_PARENT/);
  fs.rmSync(prepared.dir,{recursive:true,force:true});
  fs.rmSync(instance,{recursive:true,force:true});
});
