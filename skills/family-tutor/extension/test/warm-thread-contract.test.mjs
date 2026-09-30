
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const background = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const warmSession = readFileSync(new URL('../warm-session.mjs', import.meta.url), 'utf8');

function functionBody(source, name, nextMarker) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${nextMarker} must follow ${name}`);
  return source.slice(start, end);
}

test('warm thread delivery sends directly to the background tab without focus churn', () => {
  const body = functionBody(background, 'sendTurnToTab', '\nasync function deliverToExistingProjectTab(');
  assert.match(body, /chrome\.tabs\.sendMessage\(tab\.id, turn\)/);
  assert.doesNotMatch(body, /active:\s*true/);
  assert.doesNotMatch(body, /chrome\.tabs\.update/);
});

test('warm thread runtime does not navigate an existing thread for prompt delivery', () => {
  const body = functionBody(background, 'deliverToExistingProjectTab', '\nasync function handleTurn(');
  assert.doesNotMatch(body, /prompt=/);
  assert.doesNotMatch(body, /threadPromptUrl/);
  assert.doesNotMatch(body, /chrome\.tabs\.update\([^\n]+url/);
});

test('turn submission refreshes the live composer and performs exactly one Send click', () => {
  assert.match(content, /async function fillLiveComposer/);
  assert.match(content, /const live = composer\(\)/);
  assert.match(content, /async function waitForEnabledSend/);
  const body = functionBody(content, 'submitTurn', '\nchrome.runtime.onMessage.addListener');
  assert.equal((body.match(/button\.click\(\)/g) || []).length, 1);
  assert.doesNotMatch(body, /requestSubmit/);
  assert.doesNotMatch(body, /location\.reload|chrome\.tabs\.reload/);
});

test('turn-level failures do not trigger blind warm-thread reload and resubmit', () => {
  assert.match(background, /deliverWarmTurn/);
  assert.match(warmSession, /isWarmTabTransportError/);
  assert.match(warmSession, /recoverable:\s*false/);
  assert.match(warmSession, /if \(!isWarmTabTransportError\(firstError\)\)/);
});
