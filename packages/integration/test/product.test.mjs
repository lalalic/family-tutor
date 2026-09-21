import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createFamilyTutorProduct } from '../src/index.mjs';

function setup() {
  const deliveries = [];
  const product = createFamilyTutorProduct({
    provider: {
      send: async call => {
        deliveries.push(call);
        return { messageId: `message-${deliveries.length}` };
      },
    },
  });
  for (const familyId of ['family-a', 'family-b']) {
    product.provisionFamily({ familyId, parentProviderId: `${familyId}-parent` });
    for (const childId of ['alex', 'sam']) product.provisionChild({ familyId, childId, providerId: `${familyId}-${childId}` });
  }
  return { product, deliveries };
}

async function connectExtension(product, familyId, childIds) {
  const session = product.createSession({ familyId, scopes: ['tutor'] });
  const url = product.server.endpoint().replace(/^http:/, 'ws:').replace(/\/mcp$/, '/extension');
  const socket = new WebSocket(url);
  const turns = [];
  const waiters = [];

  function pushTurn(turn) {
    const waiter = waiters.shift();
    if (waiter) waiter(turn); else turns.push(turn);
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('extension connection timeout')), 2000);
    socket.on('error', reject);
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'bridge.auth.required') socket.send(JSON.stringify({ type: 'bridge.auth', token: session.token }));
      if (message.type === 'bridge.ready') {
        for (const childId of childIds) socket.send(JSON.stringify({ type: 'tab.bind', childId, version: '2.3.0' }));
        setTimeout(() => { clearTimeout(timer); resolve(); }, 15);
      }
      if (message.type === 'turn') pushTurn(message);
    });
  });

  return {
    session,
    socket,
    nextTurn: () => turns.length ? Promise.resolve(turns.shift()) : new Promise(resolve => waiters.push(resolve)),
  };
}

async function onboard(product, familyId) {
  const flow = product.onboarding(familyId);
  await flow.prerequisites();
  await flow.chatgpt();
  await flow.discord();
  await flow.destinations({ parent: 'parent', children: [{ childId: 'alex', destination: 'alex' }, { childId: 'sam', destination: 'sam' }] });
  await flow.projects([
    { childId: 'alex', projectId: 'g-p-12345678901234567890123456789012' },
    { childId: 'sam', projectId: 'g-p-abcdefabcdefabcdefabcdefabcdefab' },
  ]);
  return { flow, acceptance: await flow.acceptance() };
}

test('one hosted product composes Discord ingress, extension routing, ChatGPT MCP replies, onboarding, isolation, and lifecycle controls', async () => {
  const { product, deliveries } = setup();
  await product.server.start();
  const extensionA = await connectExtension(product, 'family-a', ['alex', 'sam']);
  const extensionB = await connectExtension(product, 'family-b', ['alex', 'sam']);
  try {
    const a = await onboard(product, 'family-a');
    const b = await onboard(product, 'family-b');
    assert.equal(a.acceptance.acceptance.ok, true);
    assert.equal(b.acceptance.acceptance.ok, true);
    assert.equal(a.flow.status().state.projects.ready, true);

    const aSession = product.createSession({ familyId: 'family-a', scopes: ['tutor', 'family:export', 'family:delete'] });
    const bSession = product.createSession({ familyId: 'family-b', scopes: ['tutor'] });
    const call = session => product.mcp.callTool('send_tutor_message', { destination: { type: 'child', key: 'alex' }, text: 'hello' }, { authorization: `Bearer ${session.token}` });
    assert.equal((await call(aSession)).isError, undefined);
    assert.equal((await call(bSession)).isError, undefined);
    assert.deepEqual(deliveries.slice(-2).map(item => item.channelId), ['family-a-alex', 'family-b-alex']);

    const inbound = await product.ingestDiscordMessage({ providerChannelId: 'family-a-alex', text: 'Explain fractions', messageId: 'discord-msg-a1' });
    const turn = await extensionA.nextTurn();
    assert.equal(turn.childId, 'alex');
    assert.equal(turn.correlation.correlationId, inbound.correlationId);
    assert.match(turn.prompt, /Explain fractions/);

    const wrongFamilyReply = await product.mcp.callTool('reply_to_discord', {
      correlationId: inbound.correlationId,
      text: 'wrong family',
    }, { authorization: `Bearer ${extensionB.session.token}` });
    assert.equal(wrongFamilyReply.isError, true);

    const reply = await product.mcp.callTool('reply_to_discord', {
      correlationId: inbound.correlationId,
      text: 'Fractions describe equal parts of a whole.',
      final: true,
    }, { authorization: `Bearer ${extensionA.session.token}` });
    assert.equal(reply.isError, undefined);
    assert.equal(deliveries.at(-1).channelId, 'family-a-alex');
    assert.equal(deliveries.at(-1).metadata.replyToMessageId, 'discord-msg-a1');

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
    assert.equal(product.status().families.some(family => family.familyId === 'family-a'), false);
    assert.equal(product.status().families.some(family => family.familyId === 'family-b'), true);
    assert.equal(JSON.stringify(product.status()).includes('family-b-alex'), false);
  } finally {
    extensionA.socket.close();
    extensionB.socket.close();
    await product.close();
  }
});

test('hosted server exposes health/readiness and extension relay on the same process', async () => {
  const { product } = setup();
  await product.server.start();
  try {
    const base = product.server.endpoint().replace('/mcp', '');
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok' });
    assert.deepEqual(await (await fetch(`${base}/readyz`)).json(), { status: 'ready' });
  } finally { await product.close(); }
});
