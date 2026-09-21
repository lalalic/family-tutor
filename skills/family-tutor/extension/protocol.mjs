const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:43117/ws';
export const HEALTH_STATES = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECOVERING: 'recovering',
  ERROR: 'error',
});

export function isChatGptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function projectIdFromChatGptUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !CHATGPT_HOSTS.has(url.hostname)) return null;
    const match = url.pathname.match(/(?:^|\/)(g-p-[A-Fa-f0-9]{32})(?:[-\/]|$)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function normalizeBridgeUrl(value = DEFAULT_BRIDGE_URL) {
  const url = new URL(String(value || DEFAULT_BRIDGE_URL));
  if (!['ws:', 'wss:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('bridge URL must be a loopback WebSocket URL');
  }
  return url.toString();
}

export function bindChild(bindings, childId, projectId) {
  const id = String(childId || '').trim();
  if (!id) throw new Error('child id is required');
  const project = String(projectId || '').trim();
  if (!/^g-p-[A-Za-z0-9_-]+$/.test(project)) throw new Error('valid ChatGPT project id is required');

  const next = {};
  for (const [existingChild, existingProject] of Object.entries(bindings || {})) {
    if (existingChild !== id && existingProject !== project) next[existingChild] = existingProject;
  }
  next[id] = project;
  return canonicalBindings(next);
}

export function canonicalBindings(bindings) {
  return Object.fromEntries(
    Object.entries(bindings || {})
      .map(([childId, projectId]) => [String(childId).trim(), String(projectId).trim()])
      .filter(([childId, projectId]) => childId && /^g-p-[A-Za-z0-9_-]+$/.test(projectId))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function canonicalThreadUrls(bindings, threadUrls) {
  const canonical = canonicalBindings(bindings);
  return Object.fromEntries(
    Object.entries(threadUrls || {})
      .map(([childId, threadUrl]) => [String(childId).trim(), String(threadUrl || '').trim()])
      .filter(([childId, threadUrl]) => (
        canonical[childId]
        && threadUrl
        && projectIdFromChatGptUrl(threadUrl) === canonical[childId]
      ))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function safeErrorMessage(error, fallback = 'The extension could not complete the operation.') {
  const raw = String(error?.message || error || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!raw) return fallback;
  return raw
    .replace(/(?:wss?|https?):\/\/[^\s)]+/gi, '[endpoint]')
    .replace(/\b(token|authorization|secret|password)\s*[:=]\s*[^\s,;]+/gi, (_match, name) => `${name}=[redacted]`)
    .slice(0, 240);
}

export function validateTurn(message) {
  if (!message || message.type !== 'turn') throw new Error('unsupported bridge message');
  const childId = String(message.childId || '').trim();
  const correlationId = String(message.correlation?.correlationId || '').trim();
  if (!childId) throw new Error('turn child id is required');
  if (!correlationId) throw new Error('turn correlation id is required');
  if (typeof message.prompt !== 'string') throw new Error('turn prompt must be text');

  const attachments = (message.attachments || []).map((attachment) => {
    const url = new URL(String(attachment?.url || ''));
    if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error('attachment URL must use loopback HTTP');
    }
    const mimeType = String(attachment?.mimeType || '');
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('audio/')) {
      throw new Error('only image and audio attachments are supported');
    }
    return {
      url: url.toString(),
      token: String(attachment?.token || ''),
      name: String(attachment?.name || 'image'),
      mimeType,
    };
  });

  return {
    type: 'turn',
    childId,
    prompt: message.prompt,
    correlation: { ...message.correlation, correlationId },
    attachments,
  };
}
