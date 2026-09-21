import test from 'node:test';
import assert from 'node:assert/strict';
import { createFamilyTutorProduct } from '../src/index.mjs';

function setup() {
  const deliveries = [];
  const extensionChecks = [];
  const product = createFamilyTutorProduct({
    provider: { send: async call => { deliveries.push(call); return { messageId: `message-${deliveries.length}` }; } },
    extension: { status: async input => { extensionChecks.push(input); return { ok: true, detail: 'all Project tabs ready' }; } },
  });
  for (const familyId of ['family-a', 'family-b']) {
    product.provisionFamily({ familyId, parentProviderId: `${familyId}-parent` });
    for (const childId of ['alex', 'sam']) product.provisionChild({ familyId, childId, providerId: `${familyId}-${childId}` });
  }
  return { product, deliveries, extensionChecks };
}

async function onboard(product, familyId) {
  const flow = product.onboarding(familyId);
  await flow.prerequisites(); await flow.chatgpt(); await flow.discord();
  await flow.destinations({ parent: 'parent', children: [{ childId: 'alex', destination: 'alex' }, { childId: 'sam', destination: 'sam' }] });
  await flow.projects([
    { childId: 'alex', projectId: 'g-p-12345678901234567890123456789012' },
    { childId: 'sam', projectId: 'g-p-abcdefabcdefabcdefabcdefabcdefab' },
  ]);
  return { flow, acceptance: await flow.acceptance() };
}

test('composes onboarding, MCP, Discord, extension readiness, isolation, export, delete, and revocation', async () => {
  const { product, deliveries, extensionChecks } = setup();
  const a = await onboard(product, 'family-a');
  const b = await onboard(product, 'family-b');
  assert.equal(a.acceptance.acceptance.ok, true);
  assert.equal(b.acceptance.acceptance.ok, true);
  assert.equal(a.flow.status().state.projects.ready, true);
  assert.deepEqual(extensionChecks.map(check => check.familyId), ['family-a', 'family-b']);

  const aSession = product.createSession({ familyId: 'family-a', scopes: ['tutor', 'family:export', 'family:delete'] });
  const bSession = product.createSession({ familyId: 'family-b', scopes: ['tutor'] });
  const call = session => product.mcp.callTool('send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'hello' }, { authorization: `Bearer ${session.token}` });
  assert.equal((await call(aSession)).isError, undefined);
  assert.equal((await call(bSession)).isError, undefined);
  assert.deepEqual(deliveries.slice(-2).map(item => item.channelId), ['family-a-alex', 'family-b-alex']);

  const parent = await product.mcp.callTool('send_tutor_message', { destination: { type: 'parent', key: 'parent' }, text: 'learning telemetry' }, { authorization: `Bearer ${aSession.token}` });
  assert.equal(parent.isError, undefined);
  assert.equal(deliveries.at(-1).channelId, 'family-a-parent');

  const childSession = product.createSession({ familyId: 'family-a', childId: 'alex', scopes: ['tutor'] });
  const crossChild = await call(childSession);
  assert.equal(crossChild.isError, undefined);
  const childToSibling = await product.mcp.callTool('send_tutor_message', { destination: { type: 'child', key: 'sam' }, text: 'x' }, { authorization: `Bearer ${childSession.token}` });
  assert.equal(childToSibling.isError, true);

  const crossFamily = await product.mcp.callTool('send_tutor_message', { familyId: 'family-b', destination: { type: 'child', key: 'alex' }, text: 'x' }, { authorization: `Bearer ${aSession.token}` });
  const rawProvider = await product.mcp.callTool('send_tutor_message', { destination: { type: 'child', key: 'alex', providerId: 'family-b-alex' }, text: 'x' }, { authorization: `Bearer ${aSession.token}` });
  assert.equal(crossFamily.isError, true);
  assert.equal(rawProvider.isError, true);

  const exported = product.exportFamily({ sessionToken: aSession.token, familyId: 'family-a' });
  assert.deepEqual(exported.children.map(child => child.childId), ['alex', 'sam']);
  assert.equal(exported.children[0].providerId, undefined);
  product.revokeSession(bSession.sessionId);
  assert.equal((await call(bSession)).isError, true);
  assert.equal(product.deleteFamily({ sessionToken: aSession.token, familyId: 'family-a', confirmFamilyId: 'family-a', dryRun: true }).dryRun, true);
  product.deleteFamily({ sessionToken: aSession.token, familyId: 'family-a', confirmFamilyId: 'family-a' });
  assert.equal(product.status().families['family-a'], undefined);
  assert.ok(product.status().families['family-b']);
});

test('production composition exposes health/readiness through one hosted server', async () => {
  const { product } = setup();
  await product.server.start();
  try {
    const base = product.server.endpoint().replace('/mcp', '');
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok' });
    assert.deepEqual(await (await fetch(`${base}/readyz`)).json(), { status: 'ready' });
  } finally { await product.server.close(); }
});
