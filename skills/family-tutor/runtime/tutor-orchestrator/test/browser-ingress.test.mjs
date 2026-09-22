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

  await handleBrowserChildMessage(message, { id: 'sammy', name: 'Sammy' }, {
    channelHandle: () => 'ch_kid_sender_123456789012',
    enqueue: async (value) => calls.push(value),
  });

  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].text, message.content);
  const match = calls[0].text.match(/<FAMILY_TUTOR_CONTEXT>\n([\s\S]+)\n<\/FAMILY_TUTOR_CONTEXT>/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), {
    type: 'kid',
    data: { sender: { channelId: 'ch_kid_sender_123456789012', name: 'Sammy' }, message: 'Help me with fractions', attachments: [] },
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
  await handleBrowserChildMessage(message, { id: 'maggie', name: 'Maggie' }, { channelHandle: () => 'ch_kid_sender_123456789012', enqueue: async (value) => calls.push(value) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].attachments, [{ url: image.url, name: image.name, mimeType: image.contentType, size: image.size }]);
  assert.match(calls[0].text, /"channelId":"ch_kid_sender_123456789012"/);
  assert.match(calls[0].text, /"name":"homework.png"/);
});

test('browser child ingress transcribes audio into context and does not attach the audio file', async () => {
  const calls = [];
  const audio = { id: 'aud1', url: 'https://cdn.example/voice.ogg', name: 'voice-message.ogg', contentType: 'audio/ogg', size: 4321 };
  const message = { content: '', attachments: new Map([['aud1', audio]]), channelId: 'maggie-channel', id: 'audio-message', channel: { isThread: () => false } };
  const transcribed=[];
  await handleBrowserChildMessage(message, { id: 'maggie', name: 'Maggie' }, { channelHandle: () => 'ch_kid_sender_123456789012', enqueue: async (value) => calls.push(value) }, {
    transcribe: async (attachments) => { transcribed.push(attachments); return 'Please help me with question seven.'; },
  });
  assert.equal(calls.length, 1);
  assert.equal(transcribed.length, 1);
  assert.equal(transcribed[0][0].name, audio.name);
  assert.deepEqual(calls[0].attachments, []);
  const match = calls[0].text.match(new RegExp('<FAMILY_TUTOR_CONTEXT>\\n([\\s\\S]+)\\n<\\/FAMILY_TUTOR_CONTEXT>'));
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), {
    type: 'kid',
    data: { sender: { channelId: 'ch_kid_sender_123456789012', name: 'Maggie' }, message: 'Please help me with question seven.', attachments: [] },
  });
});

test('browser child ingress transcribes audio while preserving non-audio files', async () => {
  const calls=[];
  const audio={id:'aud1',url:'https://cdn.example/voice.ogg',name:'voice.ogg',contentType:'audio/ogg',size:10};
  const pdf={id:'pdf1',url:'https://cdn.example/homework.pdf',name:'homework.pdf',contentType:'application/pdf',size:20};
  const message={content:'Look at this too',attachments:new Map([['aud1',audio],['pdf1',pdf]]),channelId:'sammy-channel',id:'mixed-message',channel:{isThread:()=>false}};
  await handleBrowserChildMessage(message,{id:'sammy',name:'Sammy'},{channelHandle:()=> 'ch_kid_sender_123456789012',enqueue:async value=>calls.push(value)},{transcribe:async()=> 'My voice note.'});
  assert.deepEqual(calls[0].attachments,[{url:pdf.url,name:pdf.name,mimeType:pdf.contentType,size:pdf.size}]);
  assert.match(calls[0].text,/"message":"Look at this too\\n\\nMy voice note\."/);
  assert.match(calls[0].text,/"name":"homework.pdf"/);
});
