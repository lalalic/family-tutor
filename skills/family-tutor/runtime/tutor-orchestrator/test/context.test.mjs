import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKidContext } from '../src/runtime-context.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, parseParentCommand } from '../src/parent-context.mjs';

function envelope(prompt) {
  const match=String(prompt).match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test('kid and parent turns use typed data-only context envelopes',()=>{
  assert.deepEqual(envelope(buildKidContext({childId:'sammy',text:'help'})),{type:'kid',data:{child:'sammy',message:'help'}});
  const parent=envelope(buildParentContextPrompt({child:{id:'sammy',name:'Sammy'},command:'!remind',value:'review fractions',authorId:'raw-author',messageId:'raw-message'}));
  assert.deepEqual(parent,{type:'parent',data:{targetChild:'sammy',request:'reminder',message:'review fractions'}});
  assert.doesNotMatch(JSON.stringify(parent),/raw-author|raw-message/);
});

test('parent status and reminder commands stay parent-routed by their logical target',()=>{
  assert.deepEqual(parseParentCommand('!remind sammy review fractions'),{command:'!remind',childId:'sammy',value:'review fractions'});
  const status=envelope(buildSlashStatusPrompt({child:{id:'sammy',name:'Sammy'},memory:'private transcript'}));
  assert.deepEqual(status.data,{targetChild:'sammy',request:'status-command',message:'status'});
});
