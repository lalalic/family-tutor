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

test('browser child ingress forwards image-only turns with typed context', async () => {
  const calls = [];
  const image = { id: 'img1', url: 'https://cdn.example/image.png', name: 'homework.png', contentType: 'image/png', size: 1234 };
  const message = { content: '', attachments: new Map([['img1', image]]), channelId: 'maggie-channel', id: 'image-message', channel: { isThread: () => false } };
  await handleBrowserChildMessage(message, { id: 'maggie' }, { enqueue: async (value) => calls.push(value) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].attachments, [{ url: image.url, name: image.name, mimeType: image.contentType, size: image.size }]);
  assert.match(calls[0].text, /"childId":"maggie"/);
});

test('browser child ingress forwards audio-only turns instead of dropping them', async () => {
  const calls = [];
  const audio = { id: 'aud1', url: 'https://cdn.example/voice.ogg', name: 'voice-message.ogg', contentType: 'audio/ogg', size: 4321 };
  const message = { content: '', attachments: new Map([['aud1', audio]]), channelId: 'maggie-channel', id: 'audio-message', channel: { isThread: () => false } };
  await handleBrowserChildMessage(message, { id: 'maggie' }, { enqueue: async (value) => calls.push(value) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].attachments, [{ url: audio.url, name: audio.name, mimeType: audio.contentType, size: audio.size }]);
  assert.match(calls[0].text, /"studentMessage":""/);
});
