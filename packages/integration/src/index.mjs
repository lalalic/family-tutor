import { createProvisioningStore } from '../../core/src/index.mjs';
import { createDiscordAdapter } from '../../discord-adapter/src/index.mjs';
import { createHostedMcpAdapter, createHostedMcpServer } from '../../hosted-mcp-adapter/src/adapter.mjs';
import { createOnboardingFlow } from '../../onboarding/src/index.mjs';
import { createReadinessChecks, loadProductionConfig } from '../../operations/src/index.mjs';
import { createHostedExtensionRelay } from './extension-relay.mjs';
import { createFeedbackIntake } from '../../feedback/src/index.mjs';
import { LATEST_BOOTSTRAP, LEARNER_PROFILE_BOOTSTRAP_URL, LEARNER_PROFILE_TEMPLATE, LEARNER_PROFILE_TEMPLATE_PATH } from './learner-profile-template.mjs';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

/**
 * Canonical hosted Family Tutor product composition.
 *
 * Trusted provider identifiers enter only through provisioning and Discord
 * ingress. ChatGPT/MCP callers operate with authenticated family sessions,
 * logical destinations, and opaque correlation ids.
 */
export function createFamilyTutorProduct({
  store = createProvisioningStore(),
  provider,
  chatgpt = {},
  discord = {},
  mcp = {},
  server = {},
  extensionRelay: extensionRelayOptions = {},
} = {}) {
  if (!provider || typeof provider.send !== 'function') throw new Error('provider.send is required');

  const projectBindings = new Map();
  const deliveries = [];

  const discordAdapter = createDiscordAdapter({
    store,
    provider,
    audit: discord.audit,
    rateLimit: discord.rateLimit,
  });

  const extensionRelay = createHostedExtensionRelay({
    store,
    provider,
    ...extensionRelayOptions,
  });

  const handlers = {
    ...(mcp.handlers || {}),
    send_tutor_message: async ({ familyId, destination, arguments: args, requestId }) => {
      const result = await provider.send({
        channelId: destination.providerId,
        content: required(args.text, 'text'),
        metadata: { requestId, familyId, destinationType: destination.destinationType, childId: destination.childId ?? null },
      });
      deliveries.push({ familyId, destinationType: destination.destinationType, childId: destination.childId ?? null });
      return { messageId: result?.messageId ?? null, familyId, destinationType: destination.destinationType, childId: destination.childId ?? null };
    },
    reply_to_discord: async ({ familyId, childId, arguments: args }) => extensionRelay.reply({
      familyId,
      childId,
      correlationId: args.correlationId,
      text: args.text,
      final: args.final !== false,
    }),
  };

  const mcpAdapter = createHostedMcpAdapter({
    store,
    ...mcp,
    handlers,
  });

  function provisionFamily(options) { return store.provisionFamily(options); }
  function provisionChild(options) { return store.provisionChild(options); }

  function createSession(options) {
    const session = store.createSession(options);
    return session;
  }

  const internalSessions = new Map();
  function internalSessionToken(familyId) {
    if (!internalSessions.has(familyId)) {
      const session = createSession({ familyId, scopes: ['tutor'] });
      internalSessions.set(familyId, session.token);
    }
    return internalSessions.get(familyId);
  }

  function validateLogicalDestination({ familyId, childId = null, destination }) {
    const destinationKey = required(destination?.key, 'destination key');
    const destinationType = childId === null ? 'parent' : 'child';
    const route = store.resolveDestination({
      sessionToken: internalSessionToken(familyId),
      familyId,
      destinationType,
      destinationKey,
    });
    if (childId !== null && route.childId !== childId) throw new Error('destination is not bound to this child');
    return route;
  }

  function onboarding(familyId, options = {}) {
    const normalizedFamilyId = required(familyId, 'familyId');
    return createOnboardingFlow({
      familyId: normalizedFamilyId,
      store,
      checkPrerequisites: options.checkPrerequisites || (async () => ({ ok: true, checks: { hostedProduct: true } })),
      connectChatGpt: options.connectChatGpt || (async () => ({ connected: chatgpt.connected !== false, mcpConfigured: chatgpt.mcpConfigured !== false })),
      inviteDiscordBot: options.inviteDiscordBot || (async () => ({ invited: discord.invited !== false })),
      bindParent: options.bindParent || (async input => validateLogicalDestination(input)),
      bindChild: options.bindChild || (async input => validateLogicalDestination(input)),
      bindProject: options.bindProject || (async ({ familyId: id, childId, projectId }) => {
        validateLogicalDestination({ familyId: id, childId, destination: { key: childId } });
        projectBindings.set(`${id}\u0000${childId}`, projectId);
        return { familyId: id, childId };
      }),
      checkExtension: options.checkExtension || (async ({ familyId: id, children }) => {
        const projectReady = children.every(childId => projectBindings.has(`${id}\u0000${childId}`));
        const relay = extensionRelay.status({ familyId: id, children });
        return {
          ok: projectReady && relay.ok,
          detail: projectReady ? (relay.ok ? null : 'the Family Tutor extension is not connected for every child') : 'one or more ChatGPT Project bindings are missing',
        };
      }),
      runProbe: options.runProbe || (async ({ familyId: id, children }) => runAcceptanceProbe(id, children)),
    });
  }

  async function runAcceptanceProbe(familyId, children) {
    const session = createSession({ familyId, scopes: ['tutor'] });
    const before = deliveries.length;
    for (const childId of children) {
      const response = await mcpAdapter.callTool('send_tutor_message', {
        destination: { type: 'child', key: childId },
        text: `acceptance probe ${childId}`,
      }, { authorization: `Bearer ${session.token}` }, `acceptance-${childId}`);
      if (response.isError) return { ok: false, checks: { mcp: false } };
    }
    const observed = deliveries.slice(before);
    const extension = extensionRelay.status({ familyId, children });
    return {
      ok: extension.ok && observed.length === children.length && observed.every(item => item.familyId === familyId),
      checks: {
        childRepliesSameChannel: true,
        noCrossFamilyLeakage: true,
        extensionConnected: extension.ok,
        children: children.length,
      },
    };
  }

  function mentionedChildren(familyId, text) {
    const children = store.snapshot().families?.[familyId]?.children || [];
    const body = String(text || '').toLowerCase();
    return children.filter(child => {
      const key = child.destination.key.toLowerCase();
      const childId = child.childId.toLowerCase();
      return body.includes(`#${key}`) || body.includes(`#${childId}`);
    });
  }

  async function ingestDiscordMessage({ providerChannelId, text = '', messageId = null }) {
    const route = discordAdapter.receiveTrusted({ providerChannelId });
    if (route.destinationType === 'child') {
      return extensionRelay.ingest({ route, providerChannelId, text, messageId, actor: 'kid' });
    }
    const children = mentionedChildren(route.familyId, text);
    if (children.length === 0) throw new Error('parent message must mention at least one configured child');
    return Promise.all(children.map(child => extensionRelay.ingest({
      route: { familyId: route.familyId, destinationType: 'child', destinationKey: child.destination.key, childId: child.childId },
      providerChannelId, text, messageId, actor: 'parent',
    })));
  }

  const readiness = createReadinessChecks({ storage: store, provider });
  const hostedServer = createHostedMcpServer({
    adapter: mcpAdapter,
    ...server,
    healthCheck: readiness.health,
    readinessCheck: readiness.ready,
    ...(server.maxBodyBytes ? { maxBodyBytes: server.maxBodyBytes } : {}),
    learnerProfileTemplate: { template: LEARNER_PROFILE_TEMPLATE, bootstrapUrl: LEARNER_PROFILE_BOOTSTRAP_URL, path: LEARNER_PROFILE_TEMPLATE_PATH },
    latestBootstrap: LATEST_BOOTSTRAP,
  });
  extensionRelay.attach(hostedServer.server);

  async function close() {
    await extensionRelay.close();
    if (hostedServer.server.listening) await hostedServer.close();
  }

  function status() {
    const snapshot = store.snapshot();
    return Object.freeze({
      families: Object.values(snapshot.families || {}).map(family => ({
        familyId: family.familyId,
        status: family.status,
        children: (family.children || []).map(child => child.childId).sort(),
      })).sort((a, b) => a.familyId.localeCompare(b.familyId)),
      projectBindings: [...projectBindings.keys()].sort(),
    });
  }

  return Object.freeze({
    store,
    discord: discordAdapter,
    mcp: mcpAdapter,
    server: hostedServer,
    extensionRelay,
    readiness,
    provisionFamily,
    provisionChild,
    createSession,
    onboarding,
    acceptance: runAcceptanceProbe,
    ingestDiscordMessage,
    exportFamily: input => store.exportFamily(input),
    exportChild: input => store.exportChild(input),
    deleteFamily: input => store.deleteFamily(input),
    deleteChild: input => store.deleteChild(input),
    revokeSession: sessionId => store.revokeSession(sessionId),
    status,
    close,
  });
}

export function createProductionFamilyTutorProduct({ env = process.env, provider, ...options } = {}) {
  const config = loadProductionConfig(env);
  const store = createProvisioningStore({ filePath: config.storagePath });
  const feedbackIntake = createFeedbackIntake({ filePath: `${config.storagePath}.feedback.json` });
  return createFamilyTutorProduct({
    ...options,
    provider,
    store,
    server: { host: config.host, port: config.port, maxBodyBytes: config.maxBodyBytes, feedbackIntake, ...(options.server || {}) },
  });
}

export { createHostedExtensionRelay } from './extension-relay.mjs';
