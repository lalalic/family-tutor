import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKidContext } from '../src/runtime-context.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, parseParentCommand, parseParentMessage } from '../src/parent-context.mjs';

function envelope(prompt) {
  const match=String(prompt).match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test('kid and parent turns use typed data-only context envelopes',()=>{
  assert.deepEqual(envelope(buildKidContext({childId:'sammy',text:'help'})),{type:'kid',data:{childId:'sammy',studentMessage:'help'}});
  const parent=envelope(buildParentContextPrompt({child:{id:'sammy',name:'Sammy'},command:'!remind',value:'review fractions',authorId:'raw-author',messageId:'raw-message'}));
  assert.deepEqual(parent,{type:'parent',data:{source:'parent',targetChild:'sammy',message:'review fractions',delivery:{replyTo:'child',parentConfirmation:'runtime'}}});
  assert.doesNotMatch(JSON.stringify(parent),/raw-author|raw-message/);
});

test('parent status and reminder commands stay parent-routed by their logical target',()=>{
  assert.deepEqual(parseParentCommand('!remind sammy review fractions'),{command:'!remind',childId:'sammy',value:'review fractions'});
  const status=envelope(buildSlashStatusPrompt({child:{id:'sammy',name:'Sammy'},memory:'private transcript'}));
  assert.deepEqual(status.data,{source:'parent',targetChild:'sammy',message:'status',delivery:{replyTo:'parent',parentConfirmation:'none'}});
});


test('natural parent reminders route to the child and keep only confirmation in parents',()=>{
  const parsed=parseParentMessage('remind <#1234567890> to do homework',[{id:'sammy',name:'Sammy'}]);
  assert.deepEqual(parsed,{command:'!remind',channelMentionId:'1234567890',value:'do homework'});
  const polite=parseParentMessage('please remind <#1234567890> to review quadratic equations',[{id:'sammy',name:'Sammy'}]);
  assert.deepEqual(polite,{command:'!remind',channelMentionId:'1234567890',value:'review quadratic equations'});
  const prompt=envelope(buildParentContextPrompt({child:{id:'sammy',name:'Sammy'},command:parsed.command,value:parsed.value}));
  assert.deepEqual(prompt,{type:'parent',data:{source:'parent',targetChild:'sammy',message:'do homework',delivery:{replyTo:'child',parentConfirmation:'runtime'}}});
});
