import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBrowserChildMessage } from '../src/browser-ingress.mjs';

test('browser child ingress sends a typed kid context instead of raw Discord text', async () => {
  const calls = [];
  const message = {
    content: 'Help me with fractions',
    attachments: new Map(),
    channelId: 'discord-channel-id',
    id: 'discord-message-id',
    channel: { isThread: () => false },
  };

  await handleBrowserChildMessage(message, { id: 'sammy' }, {
    enqueue: async (value) => calls.push(value),
  });

  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].text, message.content);
  const match = calls[0].text.match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), {
    type: 'kid',
    data: { childId: 'sammy', studentMessage: 'Help me with fractions' },
  });
  assert.equal(calls[0].childId, 'sammy');
  assert.deepEqual(calls[0].origin, {
    channelId: 'discord-channel-id',
    messageId: 'discord-message-id',
    threadId: null,
  });
});
