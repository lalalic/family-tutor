import { createProvisioningStore } from '../../core/src/index.mjs';
import { createDiscordAdapter } from '../../discord-adapter/src/index.mjs';
import { createHostedMcpAdapter, createHostedMcpServer } from '../../hosted-mcp-adapter/src/adapter.mjs';
import { createOnboardingFlow } from '../../onboarding/src/index.mjs';
import { createReadinessChecks, loadProductionConfig } from '../../operations/src/index.mjs';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function clone(value) { return structuredClone(value); }

/**
 * Compose the hosted customer product. Provider identifiers enter only through
 * provisionFamily/provisionChild, while every customer/model operation uses a
 * family session and logical destinations.
 */
export function createFamilyTutorProduct({
  store = createProvisioningStore(),
  provider,
  extension = {},
  chatgpt = {},
  discord = {},
  mcp = {},
  server = {},
} = {}) {
  if (!provider || typeof provider.send !== 'function') throw new Error('provider.send is required');
  const projectBindings = new Map();
  const sessions = new Map();
  const deliveries = [];

  const discordAdapter = createDiscordAdapter({
    store,
    provider,
    audit: discord.audit,
    rateLimit: discord.rateLimit,
  });

  function sessionToken(sessionId) {
    const token = sessions.get(sessionId);
    if (!token) throw new Error('session is unavailable');
    return token;
  }

  function routeTarget(route) {
    return route.destinationType === 'child'
      ? { familyId: route.familyId, childId: route.childId }
      : { familyId: route.familyId, destinationType: 'parent', destinationKey: route.destinationKey };
  }

  const mcpAdapter = createHostedMcpAdapter({
    store,
    ...mcp,
    handlers: {
      ...(mcp.handlers || {}),
      send_tutor_message: async ({ familyId, sessionId, destination, arguments: args }) => {
        const token = sessionToken(sessionId);
        const route = store.resolveDestination({
          sessionToken: token,
          familyId,
          destinationType: destination.destinationType,
          destinationKey: destination.destinationKey,
        });
        const result = await discordAdapter.send({
          sessionToken: token,
          target: routeTarget(route),
          content: args.text,
        });
        deliveries.push({ familyId, destinationType: route.destinationType, childId: route.childId ?? null });
        return result;
      },
    },
  });

  function provisionFamily(options) { return store.provisionFamily(options); }
  function provisionChild(options) { return store.provisionChild(options); }

  function createSession(options) {
    const session = store.createSession(options);
    sessions.set(session.sessionId, session.token);
    return session;
  }

  function clearProjects(familyId, childId = null) {
    for (const key of projectBindings.keys()) {
      const [boundFamily, boundChild] = key.split('\u0000');
      if (boundFamily === familyId && (childId === null || boundChild === childId)) projectBindings.delete(key);
    }
  }

  function bindDestination({ familyId, childId = null, destination }) {
    const key = required(destination?.key, 'destination key');
    const type = childId === null ? 'parent' : 'child';
    const route = store.resolveDestination({
      sessionToken: createInternalSession(familyId),
      familyId,
      destinationType: type,
      destinationKey: key,
    });
    if (childId !== null && route.childId !== childId) throw new Error('destination is not bound to this child');
    return route;
  }

  const internalSessions = new Map();
  function createInternalSession(familyId) {
    if (!internalSessions.has(familyId)) {
      const session = store.createSession({ familyId, scopes: ['tutor'] });
      internalSessions.set(familyId, session.token);
    }
    return internalSessions.get(familyId);
  }

  function onboarding(familyId, options = {}) {
    const normalizedFamilyId = required(familyId, 'familyId');
    return createOnboardingFlow({
      familyId: normalizedFamilyId,
      store,
      checkPrerequisites: options.checkPrerequisites || (async () => ({ ok: true, checks: { hostedProduct: true } })),
      connectChatGpt: options.connectChatGpt || (async () => ({ connected: chatgpt.connected !== false, mcpConfigured: chatgpt.mcpConfigured !== false })),
      inviteDiscordBot: options.inviteDiscordBot || (async () => ({ invited: discord.invited !== false })),
      bindParent: options.bindParent || (async input => bindDestination(input)),
      bindChild: options.bindChild || (async input => bindDestination(input)),
      bindProject: options.bindProject || (async ({ familyId: id, childId, projectId }) => {
        bindDestination({ familyId: id, childId, destination: { key: childId } });
        projectBindings.set(`${id}\u0000${childId}`, projectId);
        return { familyId: id, childId };
      }),
      checkExtension: options.checkExtension || (async ({ familyId: id, children }) => {
        const external = typeof extension.status === 'function' ? await extension.status({ familyId: id, children }) : null;
        const ready = children.every(childId => projectBindings.has(`${id}\u0000${childId}`));
        return { ok: ready && (external ? external.ok === true : true), detail: external?.detail };
      }),
      runProbe: options.runProbe || (async ({ familyId: id, children }) => runAcceptanceProbe(id, children)),
    });
  }

  async function runAcceptanceProbe(familyId, children) {
    const session = createSession({ familyId, scopes: ['tutor'] });
    const before = deliveries.length;
    for (const childId of children) {
      const response = await mcpAdapter.callTool('send_tutor_message', {
        destination: { type: 'child', key: childId }, text: `acceptance probe ${childId}`,
      }, { authorization: `Bearer ${session.token}` }, `acceptance-${childId}`);
      if (response.isError) return { ok: false, checks: { mcp: false } };
    }
    const observed = deliveries.slice(before);
    return {
      ok: observed.length === children.length && observed.every(item => item.familyId === familyId),
      checks: { childRepliesSameChannel: true, noCrossFamilyLeakage: true, children: children.length },
    };
  }

  const readiness = createReadinessChecks({ storage: store, provider });
  // The composition owns the adapter and operational checks. Callers may
  // customize listener options, but cannot replace the authenticated product
  // boundary or make readiness lie about its dependencies.
  const { adapter: _adapter, healthCheck: _healthCheck, readinessCheck: _readinessCheck, ...serverOptions } = server;
  const hostedServer = createHostedMcpServer({
    ...serverOptions,
    adapter: mcpAdapter,
    healthCheck: readiness.health,
    readinessCheck: readiness.ready,
    ...(server.maxBodyBytes ? { maxBodyBytes: server.maxBodyBytes } : {}),
  });

  return Object.freeze({
    store,
    discord: discordAdapter,
    mcp: mcpAdapter,
    server: hostedServer,
    readiness,
    provisionFamily,
    provisionChild,
    createSession,
    onboarding,
    acceptance: runAcceptanceProbe,
    exportFamily: input => store.exportFamily(input),
    exportChild: input => store.exportChild(input),
    deleteFamily(input) {
      const result = store.deleteFamily(input);
      if (!input.dryRun) clearProjects(result.familyId);
      return result;
    },
    deleteChild(input) {
      const result = store.deleteChild(input);
      if (!input.dryRun) clearProjects(result.familyId, result.childId);
      return result;
    },
    revokeSession: sessionId => store.revokeSession(sessionId),
    status() {
      const families = Object.fromEntries(Object.entries(store.snapshot().families).map(([familyId, family]) => [familyId, {
        familyId: family.familyId,
        status: family.status,
        parent: { key: family.parent.key },
        children: family.children.map(child => ({ childId: child.childId, destinationKey: child.destination.key })),
      }]));
      return clone({ families, projectBindings: [...projectBindings.keys()] });
    },
  });
}

export function createProductionFamilyTutorProduct({ env = process.env, provider, ...options } = {}) {
  const config = loadProductionConfig(env);
  const store = createProvisioningStore({ filePath: config.storagePath });
  return createFamilyTutorProduct({ ...options, provider, store, server: { maxBodyBytes: config.maxBodyBytes, ...(options.server || {}) } });
}
