import test from 'node:test';
import assert from 'node:assert/strict';
import {reactToReceivedChildMessage} from '../src/discord-reactions.mjs';

test('reacts immediately to a received child message',async()=>{
  const calls=[];
  const ok=await reactToReceivedChildMessage({react:async emoji=>calls.push(emoji)},'sammy');
  assert.equal(ok,true);
  assert.deepEqual(calls,['🤔']);
});

test('reaction failure never blocks tutoring',async()=>{
  const warnings=[];
  const ok=await reactToReceivedChildMessage(
    {react:async()=>{throw new Error('missing permission');}},
    'sammy',
    {logger:{warn:(...args)=>warnings.push(args)}},
  );
  assert.equal(ok,false);
  assert.match(warnings[0].join(' '),/sammy receive reaction failed/);
});
