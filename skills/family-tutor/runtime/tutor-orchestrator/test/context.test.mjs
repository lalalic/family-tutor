import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKidContext } from '../src/runtime-context.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, parseParentCommand, parseParentMessage, renderParentNaturalText } from '../src/parent-context.mjs';

function envelope(prompt) {
  const match=String(prompt).match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test('kid and parent turns share the same message context schema',()=>{
  const kid=envelope(buildKidContext({channelId:'ch_sammy_12345678901234567',childName:'Sammy',text:'help'}));
  assert.deepEqual(kid,{type:'kid',data:{sender:{channelId:'ch_sammy_12345678901234567',name:'Sammy'},message:'help',attachments:[]}});
  const parent=envelope(buildParentContextPrompt({channelId:'ch_parents_123456789012345',text:'remind @sammy(channelId=ch_sammy_12345678901234567) to review fractions'}));
  assert.deepEqual(parent,{type:'parent',data:{sender:{channelId:'ch_parents_123456789012345',name:'Parents'},message:'remind @sammy(channelId=ch_sammy_12345678901234567) to review fractions',attachments:[]}});
});

test('parent status and reminder commands stay parent-routed by their logical target',()=>{
  assert.deepEqual(parseParentCommand('!remind sammy review fractions'),{command:'!remind',childId:'sammy',value:'review fractions'});
  const status=envelope(buildSlashStatusPrompt({child:{id:'sammy',name:'Sammy'},channelId:'ch_parents_123456789012345',targetChannelId:'ch_sammy_12345678901234567',memory:'private transcript'}));
  assert.deepEqual(status.data,{sender:{channelId:'ch_parents_123456789012345',name:'Parents'},message:'status @sammy(channelId=ch_sammy_12345678901234567)',attachments:[]});
});


test('natural parent reminders route to the child and keep only confirmation in parents',()=>{
  const parsed=parseParentMessage('remind <#1234567890> to do homework',[{id:'sammy',name:'Sammy'}]);
  assert.deepEqual(parsed,{command:'!remind',channelMentionId:'1234567890',value:'do homework'});
  const polite=parseParentMessage('please remind <#1234567890> to review quadratic equations',[{id:'sammy',name:'Sammy'}]);
  assert.deepEqual(polite,{command:'!remind',channelMentionId:'1234567890',value:'review quadratic equations'});
  const normalized=renderParentNaturalText('remind <#1234567890> to do homework','1234567890','sammy','ch_sammy_12345678901234567');
  assert.equal(normalized,'remind @sammy(channelId=ch_sammy_12345678901234567) to do homework');
  const prompt=envelope(buildParentContextPrompt({channelId:'ch_parents_123456789012345',text:normalized}));
  assert.deepEqual(prompt,{type:'parent',data:{sender:{channelId:'ch_parents_123456789012345',name:'Parents'},message:'remind @sammy(channelId=ch_sammy_12345678901234567) to do homework',attachments:[]}});
});
