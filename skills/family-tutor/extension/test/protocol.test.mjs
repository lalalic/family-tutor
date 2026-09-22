import assert from 'node:assert/strict';
import test from 'node:test';

import { bindChild, canonicalBindings, canonicalThreadUrls, isChatGptProjectThreadUrl, isChatGptUrl, normalizeBridgeUrl, projectIdFromChatGptUrl, safeErrorMessage, validateTurn } from '../protocol.mjs';

test('binding keeps one child per ChatGPT project and one project per child', () => {
  const bindings = bindChild({ alice: 'g-p-alpha', bob: 'g-p-beta' }, 'carol', 'g-p-beta');
  assert.deepEqual(bindings, { alice: 'g-p-alpha', carol: 'g-p-beta' });
  assert.deepEqual(bindChild(bindings, 'alice', 'g-p-gamma'), { alice: 'g-p-gamma', carol: 'g-p-beta' });
});


test('bindings support an arbitrary child list without a fixed family-size cap', () => {
  let bindings = {};
  for (let index = 0; index < 40; index += 1) {
    bindings = bindChild(bindings, `kid-${index}`, `g-p-project-${index}`);
  }
  assert.equal(Object.keys(bindings).length, 40);
  assert.equal(bindings['kid-0'], 'g-p-project-0');
  assert.equal(bindings['kid-39'], 'g-p-project-39');
});

test('bindings and diagnostics are deterministic and safe to display', () => {
  assert.deepEqual(canonicalBindings({ zed: 'g-p-z', amy: 'g-p-a', invalid: 'not-a-project' }), { amy: 'g-p-a', zed: 'g-p-z' });
  assert.equal(safeErrorMessage(new Error('failed at https://127.0.0.1:43117/ws token=super-secret')), 'failed at [endpoint] token=[redacted]');
  assert.equal(safeErrorMessage(''), 'The extension could not complete the operation.');
  assert.equal(
    safeErrorMessage(new Error('bridge ws://127.0.0.1:43117/ws failed with authorization=super-secret')),
    'bridge [endpoint] failed with authorization=[redacted]',
  );
});

test('thread bindings follow project reassignment and discard stale URLs', () => {
  const alpha = 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const beta = 'g-p-cccccccccccccccccccccccccccccccc';
  const bindings = bindChild({ alice: alpha, bob: beta }, 'alice', beta);
  assert.deepEqual(bindings, { alice: beta });
  assert.deepEqual(canonicalThreadUrls(bindings, {
    alice: `https://chatgpt.com/g/${alpha}/project/c/old`,
    bob: `https://chatgpt.com/g/${beta}/project/c/bob`,
    removed: `https://chatgpt.com/g/${beta}/project/c/removed`,
    malformed: 'not-a-chatgpt-url',
  }), {});
  assert.deepEqual(canonicalThreadUrls(bindings, {
    alice: `https://chatgpt.com/g/${beta}/project/c/new`,
  }), { alice: `https://chatgpt.com/g/${beta}/project/c/new` });
});

test('only a conversation inside a ChatGPT Project counts as a linkable thread page', () => {
  const project='g-p-6aab2b72ef888191842f03b7a4bc70b6';
  assert.equal(isChatGptProjectThreadUrl(`https://chatgpt.com/g/${project}-family/project`), false);
  assert.equal(isChatGptProjectThreadUrl(`https://chatgpt.com/g/${project}-family/project/c/abc123`), true);
  assert.equal(isChatGptProjectThreadUrl('https://chatgpt.com/c/abc123'), false);
});

test('bridge, tab, and project URLs stay on allowed hosts', () => {
  assert.equal(normalizeBridgeUrl('ws://127.0.0.1:43117/ws'), 'ws://127.0.0.1:43117/ws');
  assert.equal(normalizeBridgeUrl('wss://family-tutor.qili2.com/extension'), 'wss://family-tutor.qili2.com/extension');
  assert.throws(() => normalizeBridgeUrl('wss://example.com/extension'), /hosted Family Tutor/);
  assert.equal(isChatGptUrl('https://chatgpt.com/c/123'), true);
  assert.equal(isChatGptUrl('https://example.com/chatgpt.com'), false);
  assert.equal(projectIdFromChatGptUrl('https://chatgpt.com/g/g-p-6aab2b72ef888191842f03b7a4bc70b6-neo-family-tutor-maggie/project'), 'g-p-6aab2b72ef888191842f03b7a4bc70b6');
  assert.equal(projectIdFromChatGptUrl('https://chatgpt.com/c/123'), null);
});

test('turn validation accepts correlated loopback attachments of common file types', () => {
  const turn = validateTurn({
    type: 'turn',
    childId: 'kid-a',
    prompt: 'What is in this photo?',
    correlation: { correlationId: 'turn-1' },
    attachments: [{ url: 'http://127.0.0.1:43117/blobs/1', token: 'secret', name: 'photo.jpg', mimeType: 'image/jpeg' }],
  });
  assert.equal(turn.childId, 'kid-a');
  assert.equal(turn.attachments.length, 1);
  const voice = validateTurn({
    type: 'turn',
    childId: 'kid-a',
    prompt: 'Understand this voice message.',
    correlation: { correlationId: 'turn-voice' },
    attachments: [{ url: 'http://127.0.0.1:43117/blobs/2', token: 'secret', name: 'voice.ogg', mimeType: 'audio/ogg' }],
  });
  assert.equal(voice.attachments[0].mimeType, 'audio/ogg');
  const document = validateTurn({
    type: 'turn', childId: 'kid-a', prompt: 'Read this file.', correlation: { correlationId: 'turn-file' },
    attachments: [{ url: 'http://127.0.0.1:43117/blobs/3', token: 'secret', name: 'homework.pdf', mimeType: 'application/pdf' }],
  });
  assert.equal(document.attachments[0].mimeType, 'application/pdf');
  assert.equal(document.attachments[0].name, 'homework.pdf');
  assert.throws(() => validateTurn({ type: 'turn', childId: 'kid-a', prompt: '', correlation: { correlationId: 'x' }, attachments: [{ url: 'https://example.com/x', mimeType: 'image/jpeg' }] }), /loopback/);
});
