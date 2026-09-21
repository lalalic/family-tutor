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
