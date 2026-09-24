import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioningStore } from '../../core/src/index.mjs';
import { createOnboardingFlow } from '../src/index.mjs';

function setup(overrides = {}) {
  const store = createProvisioningStore({ idGenerator: prefix => `${prefix}-onboarding` });
  store.provisionFamily({ familyId: 'family-a', parentProviderId: 'trusted-parent' });
  store.provisionChild({ familyId: 'family-a', childId: 'alex', providerId: 'trusted-alex' });
  const calls = [];
  const flow = createOnboardingFlow({
    familyId: 'family-a', store,
    checkPrerequisites: async () => ({ ok: true, checks: { chrome: true, chatgptPlus: true } }),
    connectChatGpt: async () => ({ connected: true, mcpConfigured: true }),
    inviteDiscordBot: async () => ({ invited: true }),
    bindParent: async input => { calls.push(['parent', input]); },
    bindChild: async input => { calls.push(['child', input]); },
    bindProject: async input => { calls.push(['project', input]); },
    checkExtension: async () => ({ ok: true }),
    runProbe: async input => ({ ok: true, checks: { childRepliesSameChannel: true, parentTelemetry: true, noCrossFamilyLeakage: true, children: input.children } }),
    ...overrides,
  });
  return { flow, calls };
}

test('resumes setup in ordered steps and completes acceptance', async () => {
  const { flow, calls } = setup();
  assert.equal(flow.status().current, 'prerequisites');
  await flow.prerequisites();
  assert.equal((await flow.chatgpt()).current, 'consent');
  await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' });
  await flow.chatgpt(); await flow.discord();
  await flow.destinations({ parent: { key: 'parent' }, children: [{ childId: 'alex', destination: { key: 'alex' } }] });
  await flow.projects([{ childId: 'alex', projectId: 'g-p-12345678901234567890123456789012' }]);
  assert.equal(flow.status().current, 'acceptance');
  const result = await flow.acceptance();
  assert.equal(result.acceptance.ok, true);
  assert.deepEqual(calls.map(([kind]) => kind), ['parent', 'child', 'project']);
});

test('safe incomplete state does not leak provider ids or tokens', async () => {
  const { flow } = setup({
    connectChatGpt: async () => { throw new Error('authorization=secret-token endpoint=https://private.example/mcp'); },
    inviteDiscordBot: async () => ({ invited: false, detail: 'bot invite pending' }),
  });
  const result = await flow.chatgpt();
  await flow.prerequisites();
  await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' });
  const retried = await flow.chatgpt();
  assert.equal(result.current, 'prerequisites');
  assert.match(retried.state.chatgpt.detail, /authorization=\[redacted\]/);
  assert.doesNotMatch(retried.state.chatgpt.detail, /secret-token|private\.example/);
});

test('requires explicit consent and ownership checkpoints before connecting services', async () => {
  const { flow } = setup();
  await flow.prerequisites();
  const missing = await flow.consent({ guardianConfirmed: true, noticeVersion: '2026-09-23' });
  assert.equal(missing.state.consent.ok, false);
  assert.match(missing.state.consent.detail, /guardian consent/);
  const complete = await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' });
  assert.equal(complete.state.consent.ok, true);
});

test('rejects invalid or unknown Project bindings without mutating completed state', async () => {
  const { flow } = setup();
  await flow.prerequisites(); await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' }); await flow.chatgpt(); await flow.discord();
  await flow.destinations({ parent: { key: 'parent' }, children: [{ childId: 'alex', destination: { key: 'alex' } }] });
  const result = await flow.projects([{ childId: 'alex', projectId: 'not-a-project' }]);
  assert.equal(result.state.projects.bindings.alex, undefined);
  assert.equal(result.current, 'projects');
});

test('rejects provider ids at the logical destination boundary', async () => {
  const { flow, calls } = setup();
  await flow.prerequisites(); await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' }); await flow.chatgpt(); await flow.discord();
  const result = await flow.destinations({
    parent: { channelId: 'discord-123' },
    children: [{ childId: 'alex', destination: { key: 'alex' } }],
  });
  assert.equal(result.current, 'destinations');
  assert.match(result.state.destinations.detail, /logical destination key/);
  assert.deepEqual(calls, []);
});

test('reports incomplete destination and extension checks without passing acceptance', async () => {
  const { flow } = setup({ checkExtension: async () => ({ ok: false, detail: 'extension tab token=private-token' }) });
  await flow.prerequisites(); await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' }); await flow.chatgpt(); await flow.discord();
  const missing = await flow.destinations({ parent: 'parent' });
  assert.equal(missing.current, 'destinations');
  assert.deepEqual(missing.missingProjects, ['alex']);

  await flow.destinations({ children: [{ childId: 'alex', destination: 'alex' }] });
  const result = await flow.projects([{ childId: 'alex', projectId: 'g-p-12345678901234567890123456789012' }]);
  assert.equal(result.current, 'projects');
  assert.match(result.state.projects.detail, /extension tab token=\[redacted\]/);
  const acceptance = await flow.acceptance();
  assert.equal(acceptance.ok, false);
  assert.deepEqual(acceptance.checks, ['projects']);
});

test('prevalidates all bindings so invalid input cannot partially bind', async () => {
  const { flow, calls } = setup();
  await flow.prerequisites(); await flow.consent({ guardianConfirmed: true, familyOwnerConfirmed: true, privacyNoticeAcknowledged: true, noticeVersion: '2026-09-23' }); await flow.chatgpt(); await flow.discord();
  const result = await flow.destinations({ parent: { key: 'parent' }, children: [{ childId: 'unknown', destination: { key: 'x' } }] });
  assert.equal(result.current, 'destinations');
  assert.deepEqual(calls, []);
});
