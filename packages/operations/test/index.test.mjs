import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessChecks, createSafeLogger, loadProductionConfig } from '../src/index.mjs';

test('loads bounded deployment configuration', () => {
  const config = loadProductionConfig({ NODE_ENV: 'production', FAMILY_TUTOR_STORAGE_PATH: '/srv/family-tutor/state.json' });
  assert.deepEqual(config, { nodeEnv: 'production', storagePath: '/srv/family-tutor/state.json', maxBodyBytes: 262144, host: '127.0.0.1', port: 8080, auditSink: 'stdout', publicOrigin: null });
  assert.throws(() => loadProductionConfig({ NODE_ENV: 'production' }), /STORAGE_PATH/);
  assert.throws(() => loadProductionConfig({ NODE_ENV: 'production', FAMILY_TUTOR_STORAGE_PATH: 'x', FAMILY_TUTOR_MAX_BODY_BYTES: '99' }), /MAX_BODY_BYTES/);
  assert.throws(() => loadProductionConfig({ NODE_ENV: 'production', FAMILY_TUTOR_STORAGE_PATH: 'x', PORT: '99999' }), /PORT/);
});

test('redacts secrets, provider ids, and child content from logs', () => {
  const lines = [];
  const logger = createSafeLogger(line => lines.push(line));
  const safe = logger.log({ requestId: 'req-1', familyId: 'family-a', providerId: 'discord-secret', token: 'do-not-log', text: 'child content' });
  assert.equal(safe.providerId, '[redacted]');
  assert.equal(safe.token, '[redacted]');
  assert.equal(safe.text, '[redacted]');
  assert.ok(!lines[0].includes('discord-secret'));
  assert.ok(!lines[0].includes('do-not-log'));
});

test('readiness fails closed when dependencies are missing', async () => {
  assert.deepEqual(await createReadinessChecks({}).ready(), { status: 'unavailable' });
  assert.deepEqual(await createReadinessChecks({ storage: { snapshot() {} }, provider: { send() {} } }).ready(), { status: 'ready' });
});
