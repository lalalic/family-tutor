import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProvisioningStore } from '../src/storage.mjs';

function setup(filePath = null) {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const store = createProvisioningStore({ filePath, clock: () => now, idGenerator: prefix => `${prefix}-generated` });
  return { store, advance: ms => { now += ms; } };
}

test('provisions a family and resolves logical destinations through an authenticated session', () => {
  const { store } = setup();
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  store.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'child-provider' });
  const session = store.createSession({ familyId: 'family-a' });
  assert.equal(store.authenticateSession(session.token).familyId, 'family-a');
  assert.deepEqual(store.resolveDestination({ sessionToken: session.token, familyId: 'family-a', destinationType: 'child', destinationKey: 'alex' }), { familyId: 'family-a', destinationType: 'child', destinationKey: 'alex', providerId: 'child-provider', childId: 'alex' });
  assert.throws(() => store.resolveDestination({ sessionToken: session.token, familyId: 'family-b', destinationType: 'child', destinationKey: 'alex' }), /not authorized/);
});

test('expires and revokes sessions without storing bearer tokens', () => {
  const { store, advance } = setup();
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  const session = store.createSession({ familyId: 'family-a', ttlMs: 1000 });
  assert.equal(store.snapshot().sessions[session.sessionId].token, undefined);
  advance(1001);
  assert.equal(store.authenticateSession(session.token), null);
  const fresh = store.createSession({ familyId: 'family-a' });
  store.revokeSession(fresh.sessionId);
  assert.equal(store.authenticateSession(fresh.token), null);
});

test('purges expired session records according to the configured retention window', () => {
  const { store, advance } = setup();
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  const session = store.createSession({ familyId: 'family-a', ttlMs: 1000 });
  advance(1001);
  assert.deepEqual(store.purgeExpiredSessions(), { sessionsRemoved: 1, retentionMs: 0 });
  assert.equal(store.snapshot().sessions[session.sessionId], undefined);
});

test('persists provisioning records and rejects transcript-shaped input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'family-tutor-'));
  const path = join(dir, 'state.json');
  const first = setup(path).store;
  first.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  assert.throws(() => first.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'p', transcript: 'never store this' }), /transcript/);
  const second = setup(path).store;
  assert.equal(second.snapshot().families['family-a'].parent.providerId, 'parent-provider');
  assert.match(readFileSync(path, 'utf8'), /schemaVersion/);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /never store this/);
});

test('lifecycle operations preserve binding uniqueness and family state', () => {
  const { store } = setup();
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  assert.throws(() => store.provisionChild({ familyId: 'family-a', childId: 'alex', destinationKey: 'parent', providerId: 'p' }), /duplicate destination/);
  store.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'p' });
  store.suspendFamily('family-a');
  assert.throws(() => store.createSession({ familyId: 'family-a' }), /not active/);
  store.activateFamily('family-a');
  store.removeChild({ familyId: 'family-a', childId: 'alex' });
  assert.equal(store.snapshot().families['family-a'].children.length, 0);
});

test('exports only the authenticated family record with lifecycle scopes and redaction', () => {
  const { store } = setup();
  for (const familyId of ['family-a', 'family-b']) {
    store.provisionFamily({ familyId, parentProviderId: `provider-${familyId}` });
    store.provisionChild({ familyId, childId: 'alex', providerId: `provider-${familyId}-alex` });
  }
  const familyA = store.createSession({ familyId: 'family-a', scopes: ['family:export'] });
  const exported = store.exportFamily({ sessionToken: familyA.token, familyId: 'family-a' });
  assert.equal(exported.familyId, 'family-a');
  assert.equal(exported.children[0].destinationKey, 'alex');
  assert.equal(exported.children[0].providerId, undefined);
  assert.equal(exported.sessions[0].tokenHash, undefined);
  assert.doesNotMatch(JSON.stringify(exported), /provider-family|tokenHash/);
  assert.throws(() => store.exportFamily({ sessionToken: familyA.token, familyId: 'family-b' }), /not authorized/);
  assert.throws(() => store.exportFamily({ sessionToken: store.createSession({ familyId: 'family-a' }).token, familyId: 'family-a' }), /scope is insufficient/);
});

test('child export and deletion are scoped, confirmed, and revoke only matching child sessions', () => {
  let sequence = 0;
  const store = createProvisioningStore({ clock: () => Date.parse('2026-01-01T00:00:00.000Z'), idGenerator: prefix => `${prefix}-generated-${++sequence}` });
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  store.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'alex-provider' });
  store.provisionChild({ familyId: 'family-a', childId: 'sam', providerId: 'sam-provider' });
  const operator = store.createSession({ familyId: 'family-a', scopes: ['family:export', 'family:delete'] });
  const childSession = store.createSession({ familyId: 'family-a', childId: 'alex', scopes: ['family:export', 'family:delete'] });
  assert.deepEqual(store.exportChild({ sessionToken: childSession.token, familyId: 'family-a', childId: 'alex' }).children.map(child => child.childId), ['alex']);
  assert.throws(() => store.exportChild({ sessionToken: childSession.token, familyId: 'family-a', childId: 'sam' }), /not authorized/);
  assert.deepEqual(store.deleteChild({ sessionToken: operator.token, familyId: 'family-a', childId: 'alex', confirmChildId: 'alex', dryRun: true }), { familyId: 'family-a', childId: 'alex', childrenRemoved: 1, sessionsRemoved: 1, providerBindingsRemoved: 1, dryRun: true });
  assert.throws(() => store.deleteChild({ sessionToken: operator.token, familyId: 'family-a', childId: 'alex', confirmChildId: 'wrong' }), /confirmation/);
  store.deleteChild({ sessionToken: operator.token, familyId: 'family-a', childId: 'alex', confirmChildId: 'alex' });
  assert.equal(store.snapshot().families['family-a'].children.some(child => child.childId === 'alex'), false);
  assert.equal(store.authenticateSession(childSession.token), null);
  assert.equal(store.snapshot().sessions[operator.sessionId].familyId, 'family-a');
});

test('family deletion requires an exact confirmation and removes all hosted state', () => {
  const { store } = setup();
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'parent-provider' });
  store.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'alex-provider' });
  const session = store.createSession({ familyId: 'family-a', scopes: ['family:delete'] });
  assert.throws(() => store.deleteFamily({ sessionToken: session.token, familyId: 'family-a', confirmFamilyId: 'wrong' }), /confirmation/);
  assert.deepEqual(store.deleteFamily({ sessionToken: session.token, familyId: 'family-a', confirmFamilyId: 'family-a', dryRun: true }), { familyId: 'family-a', childrenRemoved: 1, sessionsRemoved: 1, providerBindingsRemoved: 2, dryRun: true });
  store.deleteFamily({ sessionToken: session.token, familyId: 'family-a', confirmFamilyId: 'family-a' });
  assert.equal(store.snapshot().families['family-a'], undefined);
  assert.equal(store.snapshot().sessions[session.sessionId], undefined);
});
