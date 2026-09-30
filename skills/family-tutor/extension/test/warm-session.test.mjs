import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverWarmTurn, isWarmTabTransportError } from '../warm-session.mjs';

test('warm turn succeeds without reload side effects', async () => {
  const calls = [];
  const tab = { id: 42 };
  const result = await deliverWarmTurn({
    tab,
    turn: { prompt: 'hello' },
    async sendTurn(receivedTab) { calls.push(['send', receivedTab.id]); },
    async reloadTab() { calls.push(['reload']); },
    async waitReady() { calls.push(['waitReady']); return tab; },
  });
  assert.equal(result.delivered, true);
  assert.deepEqual(calls, [['send', 42]]);
});

test('turn-level failure is not reloaded or resubmitted', async () => {
  const calls = [];
  const tab = { id: 42 };
  const result = await deliverWarmTurn({
    tab,
    turn: { prompt: 'hello' },
    async sendTurn() { calls.push('send'); throw new Error('submitted prompt was not accepted by ChatGPT'); },
    async reloadTab() { calls.push('reload'); },
    async waitReady() { calls.push('waitReady'); return tab; },
  });
  assert.equal(result.delivered, false);
  assert.equal(result.recoverable, false);
  assert.deepEqual(calls, ['send']);
});

test('stale content-script transport gets one reload recovery', async () => {
  const calls = [];
  const tab = { id: 42 };
  let sends = 0;
  const result = await deliverWarmTurn({
    tab,
    turn: { prompt: 'hello' },
    async sendTurn(receivedTab) {
      calls.push(['send', receivedTab.id]);
      sends += 1;
      if (sends === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    },
    async reloadTab(tabId) { calls.push(['reload', tabId]); },
    async waitReady(tabId) { calls.push(['waitReady', tabId]); return tab; },
  });
  assert.equal(result.delivered, true);
  assert.deepEqual(calls, [['send', 42], ['reload', 42], ['waitReady', 42], ['send', 42]]);
});

test('transport classifier is narrow', () => {
  assert.equal(isWarmTabTransportError(new Error('stale Family Tutor content script')), true);
  assert.equal(isWarmTabTransportError(new Error('Could not establish connection. Receiving end does not exist.')), true);
  assert.equal(isWarmTabTransportError(new Error('enabled ChatGPT send button not found')), false);
});
