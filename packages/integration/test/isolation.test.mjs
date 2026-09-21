import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioningStore } from '../../core/src/index.mjs';
import { createDiscordAdapter, DiscordAdapterError } from '../../discord-adapter/src/index.mjs';
import { createHostedMcpAdapter } from '../../hosted-mcp-adapter/src/adapter.mjs';

function setup() {
  let sequence = 0;
  const store = createProvisioningStore({ idGenerator: prefix => `${prefix}-integration-${++sequence}` });
  for (const [familyId, parentProviderId] of [['family-a', 'discord-a-parent'], ['family-b', 'discord-b-parent']]) {
    store.provisionFamily({ familyId, parentProviderId });
    // Both families intentionally have an "alex" key: a global logical lookup
    // would route family-b traffic to family-a's provider binding.
    store.provisionChild({ familyId, childId: 'alex', providerId: `discord-${familyId}-alex` });
  }
  return {
    store,
    familyA: store.createSession({ familyId: 'family-a' }),
    familyB: store.createSession({ familyId: 'family-b' }),
  };
}

function auth(session) {
  return { authorization: `Bearer ${session.token}` };
}

test('isolates two families across Discord parent and child delivery', async () => {
  const { store, familyA, familyB } = setup();
  const deliveries = [];
  const audits = [];
  const adapter = createDiscordAdapter({
    store,
    provider: { send: async call => { deliveries.push(call); return { messageId: `message-${deliveries.length}` }; } },
    audit: async event => audits.push(event),
  });

  await adapter.send({ sessionToken: familyA.token, target: { familyId: 'family-a', childId: 'alex' }, content: 'A child turn' });
  await adapter.send({ sessionToken: familyA.token, target: { familyId: 'family-a', destinationType: 'parent', destinationKey: 'parent' }, content: 'A progress' });
  await adapter.send({ sessionToken: familyB.token, target: { familyId: 'family-b', childId: 'alex' }, content: 'B child turn' });
  await adapter.send({ sessionToken: familyB.token, target: { familyId: 'family-b', destinationType: 'parent', destinationKey: 'parent' }, content: 'B progress' });

  assert.deepEqual(deliveries.map(call => call.channelId), [
    'discord-family-a-alex', 'discord-a-parent', 'discord-family-b-alex', 'discord-b-parent',
  ]);
  assert.deepEqual(audits.filter(event => event.type === 'delivery.completed').map(event => [event.familyId, event.destinationType, event.childId]), [
    ['family-a', 'child', 'alex'], ['family-a', 'parent', null], ['family-b', 'child', 'alex'], ['family-b', 'parent', null],
  ]);
  assert.deepEqual(adapter.receive({ sessionToken: familyA.token, providerChannelId: 'discord-family-a-alex' }), {
    familyId: 'family-a', destinationType: 'child', destinationKey: 'alex', childId: 'alex',
  });
  assert.throws(() => adapter.receive({ sessionToken: familyA.token, providerChannelId: 'discord-family-b-alex' }), error => error.code === 'NOT_FOUND');
});

test('rejects Discord auth, cross-family/cross-child, malformed, and raw-provider routing safely', async () => {
  const { store, familyA, familyB } = setup();
  const deliveries = [];
  const audits = [];
  const adapter = createDiscordAdapter({
    store,
    provider: { send: async call => { deliveries.push(call); return {}; } },
    audit: async event => audits.push(event),
    rateLimit: async action => action.familyId !== 'family-b',
  });

  await assert.rejects(() => adapter.send({ sessionToken: 'not-a-token', target: { familyId: 'family-a', childId: 'alex' }, content: 'x' }), error => error instanceof DiscordAdapterError && error.code === 'UNAUTHORIZED');
  await assert.rejects(() => adapter.send({ sessionToken: familyA.token, target: { familyId: 'family-b', childId: 'alex' }, content: 'x' }), error => error.code === 'FORBIDDEN');
  await assert.rejects(() => adapter.send({ sessionToken: familyA.token, target: { familyId: 'family-a', childId: 'missing' }, content: 'x' }), error => error.code === 'NOT_FOUND');
  await assert.rejects(() => adapter.send({ sessionToken: familyA.token, target: { familyId: 'family-a', channelId: 'discord-family-b-alex' }, content: 'x' }), error => error.code === 'INVALID_TARGET');
  await assert.rejects(() => adapter.send({ sessionToken: familyA.token, target: { familyId: 'family-a' }, content: 'x' }), error => error.code === 'INVALID_TARGET');
  await assert.rejects(() => adapter.send({ sessionToken: familyB.token, target: { familyId: 'family-b', childId: 'alex' }, content: 'x' }), error => error.code === 'RATE_LIMITED');

  // A provider id, token, or message must not cross the adapter's audit boundary.
  assert.equal(deliveries.length, 0);
  assert.ok(audits.every(event => !JSON.stringify(event).includes('discord-')));
  assert.ok(audits.every(event => !JSON.stringify(event).includes('not-a-token')));
});

test('isolates hosted MCP parent/child tools, entitlements, audit, and rate limits', async () => {
  const { store, familyA, familyB } = setup();
  const calls = [];
  const audits = [];
  const limited = [];
  const adapter = createHostedMcpAdapter({
    store,
    entitlements: { 'family-b': ['premium'] },
    audit: event => audits.push(event),
    rateLimiter: event => { limited.push(event); return event.familyId !== 'family-b' || event.tool !== 'create_study_plan'; },
    handlers: {
      send_tutor_message: input => { calls.push(input); return { accepted: true }; },
      create_study_plan: input => { calls.push(input); return { plan: ['review'] }; },
    },
  });

  const invoke = (session, name, arguments_, id = 1) => adapter.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: arguments_ } }, { headers: auth(session) });
  await invoke(familyA, 'send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'A child' });
  await invoke(familyA, 'send_tutor_message', { destination: { type: 'parent', key: 'parent' }, text: 'A parent' });
  await invoke(familyB, 'send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'B child' });
  const premium = await invoke(familyB, 'create_study_plan', { destination: { type: 'child', key: 'alex' }, topic: 'fractions' });

  assert.deepEqual(calls.map(call => [call.familyId, call.destination.providerId]), [
    ['family-a', 'discord-family-a-alex'], ['family-a', 'discord-a-parent'], ['family-b', 'discord-family-b-alex'],
  ]);
  assert.equal(premium.result.isError, true);
  assert.equal(calls.length, 3);

  const crossFamily = await invoke(familyA, 'send_tutor_message', { familyId: 'family-b', destination: { type: 'child', key: 'alex' }, text: 'x' });
  const raw = await invoke(familyA, 'send_tutor_message', { destination: { type: 'child', key: 'alex', providerId: 'discord-family-b-alex' }, text: 'x' });
  const malformed = await invoke(familyA, 'send_tutor_message', { destination: { type: 'child', key: '' }, text: 'x' });
  const denied = await invoke(familyB, 'create_study_plan', { destination: { type: 'child', key: 'alex' }, topic: 'geometry' });
  assert.equal(crossFamily.result.isError, true);
  assert.equal(raw.result.isError, true);
  assert.equal(malformed.result.isError, true);
  assert.equal(denied.result.isError, true);

  const unauthenticated = await adapter.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'send_tutor_message', arguments: { destination: { type: 'child', key: 'alex' }, text: 'x' } } });
  assert.equal(unauthenticated.result.isError, true);
  assert.equal(calls.length, 3);
  assert.ok(limited.some(event => event.familyId === 'family-b' && event.tool === 'create_study_plan'));
  assert.ok(audits.every(event => !JSON.stringify(event).includes('discord-')));
  assert.ok(audits.every(event => !JSON.stringify(event).includes('fractions')));
  assert.ok(audits.every(event => !JSON.stringify(event).includes(familyA.token)));
  assert.ok(audits.every(event => Object.prototype.hasOwnProperty.call(event, 'requestId')));
});
