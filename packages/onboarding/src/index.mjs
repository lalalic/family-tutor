const STEP_ORDER = Object.freeze([
  'prerequisites',
  'chatgpt',
  'discord',
  'destinations',
  'projects',
  'acceptance',
]);

const STEP_LABELS = Object.freeze({
  prerequisites: 'Check prerequisites',
  chatgpt: 'Connect ChatGPT Developer Mode and Family Tutor MCP',
  discord: 'Invite the shared Family Tutor bot',
  destinations: 'Bind parent and child destinations',
  projects: 'Bind each child to a ChatGPT Project',
  acceptance: 'Run the Family Tutor acceptance test',
});

const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
};

function logicalDestination(value, label) {
  if (typeof value === 'string') return { key: text(value, `${label} key`) };
  if (!value || typeof value !== 'object') throw new Error(`${label} is required`);
  if (value.providerId !== undefined || value.providerChannelId !== undefined || value.channelId !== undefined) {
    throw new Error(`${label} must use a logical destination key, not a provider id`);
  }
  return { key: text(value.key, `${label} key`) };
}

function safeDetail(error) {
  const message = String(error?.message || error || 'setup is unavailable')
    .replace(/(?:wss?|https?):\/\/[^\s)]+/gi, '[endpoint]')
    .replace(/\b(token|authorization|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(?:providerId|channelId|discordChannelId)\s*[:=]\s*[^\s,;]+/gi, '$&=[redacted]');
  return message.slice(0, 240);
}

function emptyState(familyId) {
  return {
    familyId,
    prerequisites: null,
    chatgpt: { connected: false, mcpConfigured: false },
    discord: { invited: false },
    destinations: { parent: false, children: [] },
    projects: { ready: false, bindings: {} },
    acceptance: null,
  };
}

function clone(value) { return structuredClone(value); }

/**
 * Resumable customer onboarding orchestration. The coordinator keeps
 * customer-facing setup state, while provider IDs, tokens, and bindings stay
 * inside the injected trusted services. It never accepts raw provider IDs from
 * the model-facing methods.
 */
export function createOnboardingFlow({ familyId, store, checkPrerequisites, connectChatGpt, inviteDiscordBot, bindParent, bindChild, bindProject, checkExtension, runProbe } = {}) {
  const normalizedFamilyId = text(familyId, 'familyId');
  if (!store) throw new Error('provisioning store is required');
  let state = emptyState(normalizedFamilyId);

  function familySnapshot() {
    return store.snapshot?.().families?.[normalizedFamilyId] || null;
  }
  function childIds() {
    return (familySnapshot()?.children || []).map(child => child.childId);
  }
  function status() {
    const children = childIds();
    const missingProjects = children.filter(childId => !state.projects.bindings[childId]);
    const checks = {
      prerequisites: state.prerequisites?.ok === true,
      chatgpt: state.chatgpt.connected && state.chatgpt.mcpConfigured,
      discord: state.discord.invited,
      destinations: state.destinations.parent && children.length > 0 && children.every(childId => state.destinations.children.includes(childId)),
      projects: children.length > 0 && missingProjects.length === 0 && state.projects.ready === true,
      acceptance: state.acceptance?.ok === true,
    };
    const current = STEP_ORDER.find(step => !checks[step]) || null;
    return clone({ familyId: normalizedFamilyId, steps: STEP_ORDER.map(step => ({ id: step, label: STEP_LABELS[step], complete: checks[step] })), current, missingProjects, state: { ...state, destinations: { ...state.destinations, children: [...state.destinations.children] } } });
  }

  async function prerequisites(input = {}) {
    try {
      const result = checkPrerequisites ? await checkPrerequisites(input) : input;
      state.prerequisites = { ok: result?.ok === true, checks: result?.checks || {}, detail: result?.ok === true ? null : safeDetail(result?.detail || 'one or more prerequisites are incomplete') };
    } catch (error) { state.prerequisites = { ok: false, checks: {}, detail: safeDetail(error) }; }
    return status();
  }

  async function chatgpt(input = {}) {
    try {
      const result = connectChatGpt ? await connectChatGpt(input) : input;
      state.chatgpt = { connected: result?.connected === true, mcpConfigured: result?.mcpConfigured === true, detail: result?.connected && result?.mcpConfigured ? null : safeDetail(result?.detail || 'ChatGPT and the Family Tutor MCP are not both connected') };
    } catch (error) { state.chatgpt = { connected: false, mcpConfigured: false, detail: safeDetail(error) }; }
    return status();
  }

  async function discord(input = {}) {
    try {
      const result = inviteDiscordBot ? await inviteDiscordBot({ familyId: normalizedFamilyId, ...input }) : input;
      state.discord = { invited: result?.invited === true, detail: result?.invited === true ? null : safeDetail(result?.detail || 'invite the shared Family Tutor bot and try again') };
    } catch (error) { state.discord = { invited: false, detail: safeDetail(error) }; }
    return status();
  }

  async function destinations({ parent, children = [] } = {}) {
    try {
      if (parent === undefined && children.length === 0) throw new Error('choose a parent channel and at least one child channel');
      if (parent !== undefined) {
        if (!bindParent) throw new Error('parent binding service is unavailable');
        await bindParent({ familyId: normalizedFamilyId, destination: logicalDestination(parent, 'parent destination') });
        state.destinations.parent = true;
      }
      for (const child of children) {
        const childId = text(child?.childId, 'childId');
        if (!childIds().includes(childId)) throw new Error(`child is not provisioned: ${childId}`);
        if (!bindChild) throw new Error('child binding service is unavailable');
        await bindChild({ familyId: normalizedFamilyId, childId, destination: logicalDestination(child.destination, 'child destination') });
        if (!state.destinations.children.includes(childId)) state.destinations.children.push(childId);
      }
    } catch (error) { state.destinations.detail = safeDetail(error); }
    return status();
  }

  async function projects(bindings = []) {
    try {
      for (const binding of bindings) {
        const childId = text(binding?.childId, 'childId');
        const projectId = text(binding?.projectId, 'projectId');
        if (!/^g-p-[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('projectId must be a ChatGPT Project id');
        if (!childIds().includes(childId)) throw new Error(`child is not provisioned: ${childId}`);
        if (!bindProject) throw new Error('Project binding service is unavailable');
        await bindProject({ familyId: normalizedFamilyId, childId, projectId });
        state.projects.bindings[childId] = { bound: true };
      }
      if (checkExtension) {
        const result = await checkExtension({ familyId: normalizedFamilyId, children: childIds() });
        state.projects.ready = result?.ok === true;
        if (!state.projects.ready) state.projects.detail = safeDetail(result?.detail || 'the extension has not confirmed every Project binding');
      } else {
        state.projects.ready = true;
      }
    } catch (error) { state.projects.detail = safeDetail(error); }
    return status();
  }

  async function acceptance() {
    const current = status();
    if (current.current !== 'acceptance') return clone({ ok: false, checks: current.steps.filter(step => !step.complete).map(step => step.id), detail: 'complete the earlier setup steps before running acceptance' });
    try {
      const result = runProbe ? await runProbe({ familyId: normalizedFamilyId, children: childIds() }) : { ok: true };
      state.acceptance = { ok: result?.ok === true, checkedAt: new Date().toISOString(), detail: result?.ok === true ? null : safeDetail(result?.detail || 'acceptance probe did not pass'), checks: result?.checks || {} };
    } catch (error) { state.acceptance = { ok: false, checkedAt: new Date().toISOString(), detail: safeDetail(error), checks: {} }; }
    return clone({ ...status(), acceptance: state.acceptance });
  }

  return Object.freeze({ status, prerequisites, chatgpt, discord, destinations, projects, acceptance });
}

export { STEP_ORDER, STEP_LABELS };
