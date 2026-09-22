import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKidContext } from '../src/runtime-context.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, parseParentCommand, parseParentMessage, renderParentNaturalText } from '../src/parent-context.mjs';

function envelope(prompt) {
  const match=String(prompt).match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test('kid and parent turns share senderName and message before bridge correlation',()=>{
  const kid=envelope(buildKidContext({childName:'Sammy',text:'help'}));
  assert.deepEqual(kid,{type:'kid',data:{senderName:'Sammy',message:'help'}});
  const parent=envelope(buildParentContextPrompt({text:'remind @sammy to review fractions'}));
  assert.deepEqual(parent,{type:'parent',data:{senderName:'Parents',message:'remind @sammy to review fractions'}});
});

test('parent status and reminder commands stay parent-routed by their logical target',()=>{
  assert.deepEqual(parseParentCommand('!remind sammy review fractions'),{command:'!remind',childId:'sammy',value:'review fractions'});
  const status=envelope(buildSlashStatusPrompt({child:{id:'sammy',name:'Sammy'},channelId:'ch_parents_123456789012345',targetChannelId:'ch_sammy_12345678901234567',memory:'private transcript'}));
  assert.deepEqual(status.data,{senderName:'Parents',message:'status @sammy'});
});


test('parent mentions are routed deterministically without semantic intent classification',()=>{
  const parsed=parseParentMessage('remind <#1234567890> to do homework',[{id:'sammy',name:'Sammy'}]);
  assert.deepEqual(parsed,{command:'parent-query',channelMentionId:'1234567890',value:'remind <#1234567890> to do homework'});
  const normalized=renderParentNaturalText('remind <#1234567890> to do homework','1234567890','sammy','ch_sammy_12345678901234567');
  assert.equal(normalized,'remind @sammy(channelId=ch_sammy_12345678901234567) to do homework');
  const prompt=envelope(buildParentContextPrompt({text:normalized}));
  assert.deepEqual(prompt,{type:'parent',data:{senderName:'Parents',message:'remind @sammy(channelId=ch_sammy_12345678901234567) to do homework'}});
});
