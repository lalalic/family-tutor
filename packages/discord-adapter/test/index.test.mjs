import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioningStore } from '../../core/src/index.mjs';
import { createDiscordAdapter, DiscordAdapterError } from '../src/index.mjs';

function setup() {
  const store = createProvisioningStore({ idGenerator: prefix => `${prefix}-id` });
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'discord-parent' });
  store.provisionChild({ familyId: 'family-a', childId: 'alex', destinationKey: 'alex-logical', providerId: 'discord-alex' });
  return { store, session: store.createSession({ familyId: 'family-a' }) };
}
test('authenticates context and resolves logical child/parent targets', async () => {
  const { store, session } = setup(); const calls = []; const audit = [];
  const adapter = createDiscordAdapter({ store, provider: { send: async value => { calls.push(value); return { messageId: 'm1' }; } }, audit: async event => audit.push(event) });
  assert.deepEqual(adapter.receive({ sessionToken: session.token, providerChannelId: 'discord-alex' }), { familyId: 'family-a', destinationType: 'child', destinationKey: 'alex-logical', childId: 'alex' });
  await adapter.send({ sessionToken: session.token, target: { familyId: 'family-a', childId: 'alex' }, content: 'hello' });
  await adapter.send({ sessionToken: session.token, target: { familyId: 'family-a', destinationType: 'parent', destinationKey: 'parent' }, content: 'progress' });
  assert.deepEqual(calls.map(call => call.channelId), ['discord-alex', 'discord-parent']); assert.deepEqual(audit.map(event => event.type), ['delivery.requested', 'delivery.completed', 'delivery.requested', 'delivery.completed']);
});
test('rejects raw model routing, cross-family access, and rate-limited sends', async () => {
  const { store, session } = setup(); const adapter = createDiscordAdapter({ store, provider: { send: async () => ({}) }, rateLimit: async () => false });
  await assert.rejects(() => adapter.send({ sessionToken: session.token, target: { familyId: 'family-a', providerChannelId: 'discord-alex' }, content: 'x' }), error => error instanceof DiscordAdapterError && error.code === 'INVALID_TARGET');
  await assert.rejects(() => adapter.send({ sessionToken: session.token, target: { familyId: 'family-b', childId: 'alex' }, content: 'x' }), /not authorized/);
  await assert.rejects(() => adapter.send({ sessionToken: session.token, target: { familyId: 'family-a', childId: 'alex' }, content: 'x' }), error => error.code === 'RATE_LIMITED'); await assert.rejects(async () => adapter.receive({ sessionToken: session.token, providerChannelId: 'unknown' }), /not bound/);
});
test('does not leak provider failures or audit failures', async () => {
  const { store, session } = setup(); const adapter = createDiscordAdapter({ store, provider: { send: async () => { throw new Error('token=secret'); } }, audit: async () => { throw new Error('audit down'); } });
  await assert.rejects(() => adapter.send({ sessionToken: session.token, target: { familyId: 'family-a', childId: 'alex' }, content: 'x' }), error => error.code === 'DELIVERY_FAILED' && !error.message.includes('secret'));
});
