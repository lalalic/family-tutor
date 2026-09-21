import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioningStore } from '../../core/src/storage.mjs';
import { createDiscordAdapter } from '../../discord-adapter/src/index.mjs';
import { createHostedMcpAdapter } from '../src/adapter.mjs';

function setup() {
  let sequence = 0;
  const store = createProvisioningStore({ idGenerator: prefix => `${prefix}-isolation-${++sequence}` });
  for (const [familyId, parentProviderId, children] of [
    ['family-a', 'discord-parent-a', [['alex', 'discord-alex-a'], ['blair', 'discord-blair-a']]],
    ['family-b', 'discord-parent-b', [['casey', 'discord-casey-b'], ['drew', 'discord-drew-b']]],
  ]) {
    store.provisionFamily({ familyId, parentProviderId });
    for (const [childId, providerId] of children) store.provisionChild({ familyId, childId, providerId });
  }
  return {
    store,
    a: store.createSession({ familyId: 'family-a' }),
    b: store.createSession({ familyId: 'family-b' }),
    alex: store.createSession({ familyId: 'family-a', childId: 'alex' }),
  };
}

function call(name, arguments_, id = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: arguments_ } };
}

function invoke(adapter, name, arguments_, auth, id = 1) {
  return adapter.handle(call(name, arguments_, id), { headers: { authorization: `Bearer ${auth}` } });
}

test('synthetic two-family Discord routing isolates parents, children, and provider ids', async () => {
  const { store, a, b, alex } = setup();
  const deliveries = []; const audits = [];
  const adapter = createDiscordAdapter({
    store,
    provider: { send: async value => { deliveries.push(value); return { messageId: `m-${deliveries.length}` }; } },
    audit: async event => audits.push(event),
  });

  await adapter.send({ sessionToken: a.token, target: { familyId: 'family-a', childId: 'alex' }, content: 'A child' });
  await adapter.send({ sessionToken: a.token, target: { familyId: 'family-a', destinationType: 'parent', destinationKey: 'parent' }, content: 'A parent' });
  await adapter.send({ sessionToken: b.token, target: { familyId: 'family-b', childId: 'casey' }, content: 'B child' });
  assert.deepEqual(deliveries.map(item => item.channelId), ['discord-alex-a', 'discord-parent-a', 'discord-casey-b']);
  assert.equal(adapter.receive({ sessionToken: a.token, providerChannelId: 'discord-alex-a' }).childId, 'alex');
  await assert.rejects(() => adapter.send({ sessionToken: a.token, target: { familyId: 'family-b', childId: 'casey' }, content: 'cross family' }), error => error.code === 'FORBIDDEN');
  await assert.rejects(() => adapter.send({ sessionToken: alex.token, target: { familyId: 'family-a', childId: 'blair' }, content: 'cross child' }), error => error.code === 'FORBIDDEN');
  await assert.rejects(() => adapter.send({ sessionToken: alex.token, target: { familyId: 'family-a', destinationType: 'parent', destinationKey: 'parent' }, content: 'parent' }), error => error.code === 'FORBIDDEN');
  await assert.rejects(() => adapter.send({ sessionToken: a.token, target: { familyId: 'family-a', providerChannelId: 'discord-alex-a' }, content: 'raw' }), error => error.code === 'INVALID_TARGET');
  assert.throws(() => adapter.receive({ sessionToken: a.token, providerChannelId: 'discord-casey-b' }), error => error.code === 'NOT_FOUND');
  await assert.rejects(() => adapter.send({ sessionToken: 'not-a-token', target: { familyId: 'family-a', childId: 'alex' }, content: 'unauthenticated' }), error => error.code === 'UNAUTHORIZED');
  assert.equal(deliveries.length, 3);
  assert.ok(audits.every(event => !JSON.stringify(event).includes('discord-')));
});

test('synthetic two-family hosted MCP routing isolates logical destinations and redacts failures', async () => {
  const { store, a, b, alex } = setup();
  const calls = []; const audits = []; const limits = [];
  const adapter = createHostedMcpAdapter({
    store,
    audit: event => audits.push(event),
    rateLimiter: event => { limits.push(event); return true; },
    handlers: { send_tutor_message: input => { calls.push(input); return { ok: true }; } },
  });
  const send = async (session, destination, text = 'hello', id = 1) => invoke(adapter, 'send_tutor_message', { destination, text }, session.token, id);

  assert.equal((await send(a, { type: 'child', key: 'alex' })).result.isError, undefined);
  assert.equal((await send(a, { type: 'parent', key: 'parent' }, 'parent')).result.isError, undefined);
  assert.equal((await send(b, { type: 'child', key: 'casey' })).result.isError, undefined);
  assert.deepEqual(calls.map(item => item.destination.providerId), ['discord-alex-a', 'discord-parent-a', 'discord-casey-b']);
  assert.equal((await send(a, { type: 'child', key: 'casey' }, 'cross family')).result.isError, true);
  assert.equal((await send(alex, { type: 'child', key: 'blair' }, 'cross child')).result.isError, true);
  assert.equal((await send(alex, { type: 'parent', key: 'parent' }, 'parent')).result.isError, true);
  assert.equal((await send(a, { type: 'child', key: 'alex', providerId: 'discord-alex-a' }, 'raw')).result.isError, true);
  assert.equal((await invoke(adapter, 'send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'unauthenticated' }, 'wrong-token', 9)).result.isError, true);
  assert.equal(limits.length, 6);
  assert.deepEqual(audits.slice(0, 3).map(event => [event.outcome, event.familyId, event.destinationKey]), [
    ['succeeded', 'family-a', 'alex'], ['succeeded', 'family-a', 'parent'], ['succeeded', 'family-b', 'casey'],
  ]);
  assert.ok(audits.slice(3).every(event => event.outcome === 'rejected'));
  assert.ok(audits.every(event => !JSON.stringify(event).includes('discord-')));
  assert.ok(audits.every(event => !JSON.stringify(event).includes('hello')));
});

test('hosted MCP applies family rate limits before handlers and never leaks provider errors', async () => {
  const { store, a } = setup(); const audits = []; let called = false;
  const adapter = createHostedMcpAdapter({
    store,
    audit: event => audits.push(event),
    rateLimiter: () => ({ allowed: false }),
    handlers: { send_tutor_message: () => { called = true; throw new Error('token=secret-provider-credential'); } },
  });
  const response = await invoke(adapter, 'send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'secret learner text' }, a.token, 10);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /rate limit exceeded/);
  assert.equal(called, false);
  assert.ok(!JSON.stringify(audits).includes(a.token));
  assert.ok(!JSON.stringify(audits).includes('secret learner text'));
  assert.ok(!JSON.stringify(audits).includes('provider-credential'));
});

test('hosted MCP redacts malformed and handler failures in response and audit records', async () => {
  const { store, a } = setup(); const audits = [];
  const adapter = createHostedMcpAdapter({ store, audit: event => audits.push(event), handlers: { send_tutor_message: () => { throw new Error('token=secret-provider-credential'); } } });
  const malformed = await invoke(adapter, 'send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'x', rawProviderId: 'discord-alex-a' }, a.token, 11);
  const failed = await invoke(adapter, 'send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'x' }, a.token, 12);
  assert.equal(malformed.result.isError, true);
  assert.equal(failed.result.content[0].text, '{"error":"request rejected"}');
  assert.ok(!JSON.stringify(malformed).includes('discord-alex-a'));
  assert.ok(!JSON.stringify(audits).includes('secret-provider-credential'));
});
