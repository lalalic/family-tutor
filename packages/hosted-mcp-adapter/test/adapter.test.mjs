import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioningStore } from '../../core/src/storage.mjs';
import { createHostedMcpAdapter } from '../src/adapter.mjs';

function setup() {
  const store = createProvisioningStore({ idGenerator: prefix => `${prefix}-test` });
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'provider-parent' });
  store.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'provider-alex' });
  const session = store.createSession({ familyId: 'family-a' });
  return { store, session, auth: { authorization: `Bearer ${session.token}` } };
}

test('authenticates the family and resolves only logical destinations', async () => {
  const { store, session, auth } = setup();
  const calls = [];
  const adapter = createHostedMcpAdapter({ store, handlers: { send_tutor_message: input => { calls.push(input); return { ok: true }; } } });
  const response = await adapter.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_tutor_message', arguments: { destination: { type: 'child', key: 'alex' }, text: 'hello' } } }, { headers: auth });
  assert.equal(response.result.isError, undefined);
  assert.equal(calls[0].familyId, 'family-a');
  assert.equal(calls[0].destination.providerId, 'provider-alex');
  assert.equal(calls[0].sessionId, session.sessionId);
});

test('rejects raw provider ids and caller-selected tenant identity', async () => {
  const { store, auth } = setup();
  let called = false;
  const adapter = createHostedMcpAdapter({ store, handlers: { send_tutor_message: () => { called = true; } } });
  for (const arguments_ of [
    { familyId: 'family-b', destination: { type: 'child', key: 'alex' }, text: 'x' },
    { destination: { type: 'child', key: 'alex', providerId: 'provider-alex' }, text: 'x' },
  ]) {
    const response = await adapter.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'send_tutor_message', arguments: arguments_ } }, { headers: auth });
    assert.equal(response.result.isError, true);
  }
  assert.equal(called, false);
});

test('keeps premium tools hidden and unavailable without an explicit entitlement', async () => {
  const { store, auth } = setup();
  const adapter = createHostedMcpAdapter({ store, handlers: { create_study_plan: () => ({ plan: [] }) } });
  const list = await adapter.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { headers: auth });
  assert.deepEqual(list.result.tools.map(tool => tool.name), ['send_tutor_message']);
  const response = await adapter.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_study_plan', arguments: { destination: { type: 'child', key: 'alex' }, topic: 'fractions' } } }, { headers: auth });
  assert.equal(response.result.isError, true);
});

test('requires authentication even for tool discovery', async () => {
  const { store } = setup();
  const adapter = createHostedMcpAdapter({ store });
  const response = await adapter.handle({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
  assert.equal(response.error.code, -32001);
});

test('normalizes malformed tool arguments without exposing argument details', async () => {
  const { store, auth } = setup();
  const audits = [];
  const adapter = createHostedMcpAdapter({ store, audit: event => audits.push(event) });
  const response = await adapter.handle({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'send_tutor_message', arguments: null },
  }, { headers: auth });
  assert.deepEqual(response.result, { content: [{ type: 'text', text: '{"error":"request rejected"}' }], isError: true });
  assert.equal(audits[0].reason, 'request rejected');
});

test('turns handler exceptions into a stable response and sanitized audit reason', async () => {
  const { store, auth } = setup();
  const audits = [];
  const adapter = createHostedMcpAdapter({
    store,
    audit: event => audits.push(event),
    handlers: { send_tutor_message: () => { throw new Error('provider token=secret-value'); } },
  });
  const response = await adapter.handle({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'send_tutor_message', arguments: { destination: { type: 'child', key: 'alex' }, text: 'hello' } },
  }, { headers: auth });
  assert.equal(response.result.content[0].text, '{"error":"request rejected"}');
  assert.equal(audits[0].reason, 'request rejected');
  assert.ok(!JSON.stringify(response).includes('secret-value'));
  assert.ok(!JSON.stringify(audits).includes('secret-value'));
});

test('treats malformed or throwing authentication stores as authentication failures', async () => {
  const store = {
    authenticateSession: () => { throw new Error('database password=secret'); },
    resolveDestination: () => { throw new Error('unreachable'); },
  };
  const adapter = createHostedMcpAdapter({ store });
  const response = await adapter.handle({ jsonrpc: '2.0', id: 10, method: 'tools/list' }, { headers: { authorization: 'Bearer malformed' } });
  assert.deepEqual(response.error, { code: -32001, message: 'authentication required' });
  assert.ok(!JSON.stringify(response).includes('secret'));
});

test('audits rejection and invokes rate-limit hook after authentication', async () => {
  const { store, auth } = setup();
  const audits = []; const limits = [];
  const adapter = createHostedMcpAdapter({ store, audit: event => audits.push(event), rateLimiter: event => limits.push(event), handlers: { send_tutor_message: () => ({ ok: true }) } });
  await adapter.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'send_tutor_message', arguments: { destination: { type: 'child', key: 'missing' }, text: 'x' } } }, { headers: auth });
  assert.equal(limits.length, 1);
  assert.equal(limits[0].familyId, 'family-a');
  assert.equal(audits[0].outcome, 'rejected');
  assert.equal(audits[0].destinationKey, null);
  assert.equal(audits[0].familyId, 'family-a');
});

test('a rate-limit denial stops the provider handler', async () => {
  const { store, auth } = setup(); let called = false;
  const adapter = createHostedMcpAdapter({ store, rateLimiter: () => ({ allowed: false }), handlers: { send_tutor_message: () => { called = true; } } });
  const response = await adapter.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'send_tutor_message', arguments: { destination: { type: 'child', key: 'alex' }, text: 'x' } } }, { headers: auth });
  assert.equal(response.result.isError, true);
  assert.equal(called, false);
});
