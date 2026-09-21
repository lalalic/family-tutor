import { DEFAULT_BRIDGE_URL, HEALTH_STATES, bindChild, canonicalBindings, canonicalThreadUrls, isChatGptUrl, normalizeBridgeUrl, projectIdFromChatGptUrl, safeErrorMessage, validateTurn } from './protocol.mjs';

const BOOTSTRAP_URL = chrome.runtime.getURL('bootstrap.json');
const GROUP_TITLE = 'family-tutor';
let socket = null;
let availableChildren = [];
const kidRequests = new Map();
let reconnectTimer = null;
let keepAliveTimer = null;
let familyGroupId = null;
let reconcileQueue = Promise.resolve();
let restoreTimer = null;
let restoreFallbackTimer = null;

async function settings() {
  return chrome.storage.local.get({ bindings: {}, threadUrls: {}, health: defaultHealth(), bridgeUrl: DEFAULT_BRIDGE_URL, bridgeToken: '', bridgeRefreshToken: '' });
}

function defaultHealth() {
  return { state: HEALTH_STATES.DISCONNECTED, lastError: null, lastConnectedAt: null, recoveryCount: 0 };
}

const OAUTH_ORIGIN = 'https://family-tutor.qili2.com';
const OAUTH_CLIENT_ID = 'family-tutor-extension';
const OAUTH_RESOURCE = `${OAUTH_ORIGIN}/ws`;

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function randomBase64Url(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function authorizeExtensionSession({ interactive = false } = {}) {
  const redirectUri = chrome.identity.getRedirectURL('family-tutor');
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(24);
  const challenge = await sha256Base64Url(verifier);
  const authorize = new URL(`${OAUTH_ORIGIN}/oauth/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', OAUTH_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'extension');
  authorize.searchParams.set('resource', OAUTH_RESOURCE);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authorize.toString(), interactive });
  if (!callbackUrl) throw new Error('Family Tutor authorization was cancelled.');
  const callback = new URL(callbackUrl);
  if (callback.searchParams.get('state') !== state) throw new Error('Family Tutor authorization state mismatch.');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error(callback.searchParams.get('error_description') || callback.searchParams.get('error') || 'Family Tutor authorization failed.');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OAUTH_CLIENT_ID,
    code_verifier: verifier,
    resource: OAUTH_RESOURCE,
  });
  const response = await fetch(`${OAUTH_ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token || !token.refresh_token) throw new Error(token.error_description || token.error || 'Family Tutor token exchange failed.');
  return { accessToken: token.access_token, refreshToken: token.refresh_token };
}

function tokenExpiresSoon(token, skewSeconds = 300) {
  try {
    const payload = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp || 0) <= Math.floor(Date.now() / 1000) + skewSeconds;
  } catch {
    return true;
  }
}

async function refreshExtensionSession(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
    resource: OAUTH_RESOURCE,
  });
  const response = await fetch(`${OAUTH_ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) throw new Error(token.error_description || token.error || 'Family Tutor session refresh failed.');
  return token.access_token;
}

async function ensureHostedSession({ interactive = false } = {}) {
  let current = await settings();
  if (current.bridgeToken && current.bridgeRefreshToken) return current;
  const session = await authorizeExtensionSession({ interactive });
  await chrome.storage.local.set({
    bridgeUrl: DEFAULT_BRIDGE_URL,
    bridgeToken: session.accessToken,
    bridgeRefreshToken: session.refreshToken,
  });
  return { ...current, bridgeUrl: DEFAULT_BRIDGE_URL, bridgeToken: session.accessToken, bridgeRefreshToken: session.refreshToken };
}

const ACTION_ICON_PATHS = Object.freeze({
  connected: { 16: 'icons/connected-16.png', 32: 'icons/connected-32.png', 48: 'icons/connected-48.png', 128: 'icons/connected-128.png' },
  recovering: { 16: 'icons/recovering-16.png', 32: 'icons/recovering-32.png', 48: 'icons/recovering-48.png', 128: 'icons/recovering-128.png' },
  error: { 16: 'icons/error-16.png', 32: 'icons/error-32.png', 48: 'icons/error-48.png', 128: 'icons/error-128.png' },
  disconnected: { 16: 'icons/disconnected-16.png', 32: 'icons/disconnected-32.png', 48: 'icons/disconnected-48.png', 128: 'icons/disconnected-128.png' },
});

async function syncActionHealth(health) {
  const state = ACTION_ICON_PATHS[health?.state] ? health.state : HEALTH_STATES.DISCONNECTED;
  const kidCount = availableChildren.length;
  const badgeText = kidCount > 999 ? '999+' : String(kidCount);
  const badgeColors = {
    connected: '#22c55e',
    recovering: '#f59e0b',
    error: '#ef4444',
    disconnected: '#6b7280',
  };
  await chrome.action.setIcon({ path: ACTION_ICON_PATHS[state] });
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColors[state] });
  await chrome.action.setTitle({ title: `Family Tutor · ${state} · ${configuredKids} configured kid${configuredKids === 1 ? '' : 's'}` });
}

async function updateHealth(patch) {
  const current = await chrome.storage.local.get({ health: defaultHealth() });
  const health = { ...defaultHealth(), ...current.health, ...patch };
  await chrome.storage.local.set({ health });
  await syncActionHealth(health).catch(() => {});
}

async function applyBootstrap() {
  try {
    const response = await fetch(BOOTSTRAP_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const bootstrap = await response.json();
    const update = {};
    if (bootstrap?.bindings && typeof bootstrap.bindings === 'object') update.bindings = bootstrap.bindings;
    if (bootstrap?.bridgeUrl) update.bridgeUrl = normalizeBridgeUrl(bootstrap.bridgeUrl);
    if (typeof bootstrap?.bridgeToken === 'string') update.bridgeToken = bootstrap.bridgeToken;
    if (Object.keys(update).length) await chrome.storage.local.set(update);
  } catch {
    // bootstrap.json is optional and intentionally private when used.
  }
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function requestKidAction(message, timeoutMs = 5000) {
  if (socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Family Tutor is not connected.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { kidRequests.delete(requestId); reject(new Error('Family Tutor did not respond.')); }, timeoutMs);
    kidRequests.set(requestId, { resolve, reject, timer });
    send({ ...message, requestId });
  });
}

async function reportBindings() {
  const { bindings } = await settings();
  const version = chrome.runtime.getManifest().version;
  for (const childId of Object.keys(canonicalBindings(bindings))) send({ type: 'tab.bind', childId, version });
}

async function familyGroups() {
  return chrome.tabGroups.query({ title: GROUP_TITLE });
}

async function getCachedFamilyGroup() {
  if (!Number.isInteger(familyGroupId)) return null;
  try {
    const group = await chrome.tabGroups.get(familyGroupId);
    if (group?.title === GROUP_TITLE) return group;
  } catch {}
  familyGroupId = null;
  return null;
}

async function primaryFamilyGroup() {
  const cached = await getCachedFamilyGroup();
  if (cached) return cached;
  const groups = await familyGroups();
  const group = groups[0] || null;
  familyGroupId = Number.isInteger(group?.id) ? group.id : null;
  return group;
}

async function ensureFamilyGroup(seedTabId) {
  let group = await primaryFamilyGroup();
  if (!group) {
    if (!Number.isInteger(seedTabId)) return null;
    const id = await chrome.tabs.group({ tabIds: [seedTabId] });
    group = await chrome.tabGroups.update(id, { title: GROUP_TITLE, collapsed: false });
    familyGroupId = id;
    return group;
  }

  const duplicates = (await familyGroups()).filter((item) => item.id !== group.id);
  for (const duplicate of duplicates) {
    const tabs = await chrome.tabs.query({ groupId: duplicate.id });
    if (!tabs.length) continue;
    const ids = tabs.map((tab) => tab.id).filter(Number.isInteger);
    if (!ids.length) continue;
    await chrome.tabs.move(ids, { windowId: group.windowId, index: -1 });
    await chrome.tabs.group({ groupId: group.id, tabIds: ids });
  }
  await chrome.tabGroups.update(group.id, { title: GROUP_TITLE, collapsed: false });
  return group;
}

async function putTabInFamilyGroup(tabId, group = null) {
  if (!Number.isInteger(tabId)) throw new Error('invalid ChatGPT tab');
  let tab = await chrome.tabs.get(tabId);
  group ||= await ensureFamilyGroup(tabId);
  if (!group) throw new Error('could not create family-tutor tab group');

  if (tab.windowId !== group.windowId) {
    const moved = await chrome.tabs.move(tab.id, { windowId: group.windowId, index: -1 });
    tab = Array.isArray(moved) ? moved[0] : moved;
  }
  if (tab.groupId !== group.id) await chrome.tabs.group({ groupId: group.id, tabIds: [tab.id] });
  return chrome.tabs.get(tab.id);
}

async function allChatGptTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  return tabs.filter((tab) => Number.isInteger(tab.id) && isChatGptUrl(tab.url));
}

async function waitForExactThread(threadUrl, timeoutMs = 6000) {
  if (!threadUrl) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await allChatGptTabs();
    const exact = sortTabs(tabs.filter((tab) => tab.url === threadUrl))[0] || null;
    if (exact) return exact;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function sortTabs(tabs) {
  return [...tabs].sort(
    (a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active))
      || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0),
  );
}

async function createProjectTab(projectId, threadUrl = null) {
  const url = threadUrl && projectIdFromChatGptUrl(threadUrl) === projectId
    ? threadUrl
    : `https://chatgpt.com/g/${projectId}/project`;
  const tab = await chrome.tabs.create({ url, active: false });
  if (!Number.isInteger(tab?.id)) throw new Error('could not open ChatGPT project tab');
  return tab;
}

async function waitForProjectTab(tabId, projectId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const current = await chrome.tabs.get(tabId);
      if (current.status === 'complete' && projectIdFromChatGptUrl(current.url) === projectId) return current;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('ChatGPT project tab did not finish loading');
}

async function reconcileFamilyTabsUnlocked(preferredTabs = {}, { allowCreate = true } = {}) {
  const { bindings, threadUrls } = await settings();
  const entries = Object.entries(bindings);
  if (!entries.length) {
    for (const group of await familyGroups()) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      const ids = tabs.map((tab) => tab.id).filter(Number.isInteger);
      if (ids.length) await chrome.tabs.ungroup(ids);
    }
    familyGroupId = null;
    return {};
  }

  const allTabs = await allChatGptTabs();
  let seed = null;
  for (const [childId, projectId] of entries) {
    const preferredId = preferredTabs[childId];
    if (Number.isInteger(preferredId)) {
      try {
        const tab = await chrome.tabs.get(preferredId);
        if (projectIdFromChatGptUrl(tab.url) === projectId) {
          seed = tab;
          break;
        }
      } catch {}
    }
    const threadUrl = threadUrls[childId];
    if (threadUrl) {
      seed = sortTabs(allTabs.filter((tab) => tab.url === threadUrl))[0] || null;
      if (seed) break;
    }
    seed = sortTabs(allTabs.filter((tab) => projectIdFromChatGptUrl(tab.url) === projectId))[0] || null;
    if (seed) break;
  }
  if (!seed && allowCreate) seed = await createProjectTab(entries[0][1], threadUrls[entries[0][0]]);
  if (!seed) return {};

  const group = await ensureFamilyGroup(seed.id);
  const chosen = new Set();
  const childTabs = {};
  const discoveredThreadUrls = { ...threadUrls };

  for (const [childId, projectId] of entries) {
    let tab = null;
    const threadUrl = threadUrls[childId];
    const preferredId = preferredTabs[childId];
    if (Number.isInteger(preferredId)) {
      try {
        const candidate = await chrome.tabs.get(preferredId);
        if (projectIdFromChatGptUrl(candidate.url) === projectId) tab = candidate;
      } catch {}
    }

    if (!tab && threadUrl) {
      const grouped = await chrome.tabs.query({ groupId: group.id });
      tab = sortTabs(grouped.filter((candidate) => candidate.url === threadUrl))[0] || null;
    }
    if (!tab && threadUrl) {
      const candidates = await allChatGptTabs();
      tab = sortTabs(candidates.filter((candidate) => candidate.url === threadUrl))[0] || null;
    }
    if (!tab && !threadUrl) {
      const grouped = await chrome.tabs.query({ groupId: group.id });
      tab = sortTabs(grouped.filter((candidate) => projectIdFromChatGptUrl(candidate.url) === projectId))[0] || null;
    }
    if (!tab && !threadUrl) {
      const candidates = await allChatGptTabs();
      tab = sortTabs(candidates.filter((candidate) => projectIdFromChatGptUrl(candidate.url) === projectId))[0] || null;
    }
    if (!tab && allowCreate) tab = await createProjectTab(projectId, threadUrl);
    if (!tab) continue;

    tab = await putTabInFamilyGroup(tab.id, group);
    chosen.add(tab.id);
    childTabs[childId] = tab.id;
    try {
      const currentUrl = new URL(tab.url);
      if (projectIdFromChatGptUrl(tab.url) === projectId && currentUrl.pathname.includes('/c/')) {
        discoveredThreadUrls[childId] = tab.url;
      }
    } catch {}
  }

  const grouped = await chrome.tabs.query({ groupId: group.id });
  const extras = grouped.map((tab) => tab.id).filter((id) => Number.isInteger(id) && !chosen.has(id));
  if (extras.length) await chrome.tabs.ungroup(extras);

  // Chrome session restore may resurrect duplicate copies of the exact saved
  // Family Tutor threads. Keep the chosen tab for each child and close only
  // tabs whose URL exactly matches a saved child thread URL.
  const allAfter = await allChatGptTabs();
  const duplicateIds = [];
  for (const [childId] of entries) {
    const exactUrl = discoveredThreadUrls[childId];
    const keepId = childTabs[childId];
    if (!exactUrl || !Number.isInteger(keepId)) continue;
    for (const candidate of allAfter) {
      if (candidate.id !== keepId && candidate.url === exactUrl && Number.isInteger(candidate.id)) {
        duplicateIds.push(candidate.id);
      }
    }
  }
  if (duplicateIds.length) await chrome.tabs.remove([...new Set(duplicateIds)]);

  await chrome.tabGroups.update(group.id, { title: GROUP_TITLE, collapsed: false });
  if (JSON.stringify(discoveredThreadUrls) !== JSON.stringify(threadUrls)) {
    await chrome.storage.local.set({ threadUrls: discoveredThreadUrls });
  }
  return childTabs;
}

function reconcileFamilyTabs(preferredTabs = {}, options = {}) {
  const run = reconcileQueue.catch(() => {}).then(() => reconcileFamilyTabsUnlocked(preferredTabs, options));
  reconcileQueue = run;
  return run;
}

async function resolveProjectTab(projectId) {
  const group = await primaryFamilyGroup();
  if (!group) return null;
  const tabs = await chrome.tabs.query({ groupId: group.id });
  return sortTabs(
    tabs.filter(
      (tab) => tab.status === 'complete'
        && isChatGptUrl(tab.url)
        && projectIdFromChatGptUrl(tab.url) === projectId,
    ),
  )[0] || null;
}

async function handleTurn(raw) {
  const turn = validateTurn(raw);
  const { bindings, threadUrls } = await settings();
  const projectId = bindings[turn.childId];
  if (!projectId) throw new Error(`no ChatGPT project is assigned for child ${turn.childId}`);

  await reconcileFamilyTabs({}, { allowCreate: false });
  const savedThreadUrl = threadUrls[turn.childId];
  if (savedThreadUrl) {
    const restored = await waitForExactThread(savedThreadUrl);
    if (restored) await reconcileFamilyTabs({ [turn.childId]: restored.id }, { allowCreate: false });
  }
  await reconcileFamilyTabs();
  const deadline = Date.now() + 15000;
  let lastError = null;
  let reloaded = false;

  while (Date.now() < deadline) {
    let tab = await resolveProjectTab(projectId);
    const threadUrl = threadUrls[turn.childId];
    if (threadUrl && tab?.url !== threadUrl) {
      const group = await primaryFamilyGroup();
      const grouped = Number.isInteger(group?.id) ? await chrome.tabs.query({ groupId: group.id }) : [];
      tab = sortTabs(grouped.filter((candidate) => candidate.url === threadUrl))[0] || null;
    }
    if (!Number.isInteger(tab?.id)) {
      await reconcileFamilyTabs();
      tab = await resolveProjectTab(projectId);
    }
    if (!Number.isInteger(tab?.id)) {
      lastError = new Error(`grouped ChatGPT project for ${turn.childId} is unavailable`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, turn);
      return;
    } catch (error) {
      lastError = error;
      if (!reloaded) {
        reloaded = true;
        await chrome.tabs.reload(tab.id).catch(() => {});
        await waitForProjectTab(tab.id, projectId, 10000).catch(() => {});
      } else {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  throw lastError || new Error(`ChatGPT project for ${turn.childId} did not become ready`);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 1500);
}

async function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  let current = await settings();
  const bridgeUrl = normalizeBridgeUrl(current.bridgeUrl || DEFAULT_BRIDGE_URL);
  if (bridgeUrl.startsWith('wss://')) {
    try {
      if (!current.bridgeToken || !current.bridgeRefreshToken) current = await ensureHostedSession({ interactive: false });
      if (!current.bridgeToken || tokenExpiresSoon(current.bridgeToken)) {
        const bridgeToken = await refreshExtensionSession(current.bridgeRefreshToken);
        await chrome.storage.local.set({ bridgeToken });
        current = { ...current, bridgeToken };
      }
    } catch (error) {
      await updateHealth({ state: HEALTH_STATES.ERROR, lastError: safeErrorMessage(error), recoveryCount: 0 });
      return;
    }
  }
  const ws = new WebSocket(bridgeUrl);
  socket = ws;
  ws.onopen = async () => {
    if (socket !== ws) return;
    clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => send({ type: 'extension.ping' }), 20_000);
  };
  ws.onmessage = async ({ data }) => {
    if (socket !== ws) return;
    let message;
    try {
      message = JSON.parse(data);
      if (message.type === 'bridge.auth.required') {
        const current = await settings();
        if (!current.bridgeToken) throw new Error('Hosted Family Tutor connection requires a family session token.');
        send({ type: 'bridge.auth', token: current.bridgeToken });
        return;
      }
      if (message.type === 'bridge.ready') {
        availableChildren = Array.isArray(message.children)
          ? message.children.map((child) => typeof child === 'string' ? { id: child, name: child } : { id: String(child?.id || ''), name: String(child?.name || child?.id || '') }).filter((child) => child.id)
          : [];
        const validIds = new Set(availableChildren.map((child) => child.id));
        const current = await settings();
        const nextBindings = Object.fromEntries(Object.entries(current.bindings || {}).filter(([childId]) => validIds.has(childId)));
        const nextThreadUrls = canonicalThreadUrls(nextBindings, current.threadUrls || {});
        if (JSON.stringify(nextBindings) !== JSON.stringify(current.bindings) || JSON.stringify(nextThreadUrls) !== JSON.stringify(current.threadUrls)) {
          await chrome.storage.local.set({ bindings: nextBindings, threadUrls: nextThreadUrls });
        }
        await reportBindings();
        await updateHealth({ state: HEALTH_STATES.CONNECTED, lastError: null, lastConnectedAt: new Date().toISOString(), recoveryCount: 0 });
        return;
      }
      if (message.type === 'kid.result') {
        const pending = kidRequests.get(String(message.requestId || ''));
        if (!pending) return;
        clearTimeout(pending.timer);
        kidRequests.delete(String(message.requestId || ''));
        if (message.ok) pending.resolve(message); else pending.reject(new Error(message.error || 'Family Tutor could not update the kid.'));
        return;
      }
      if (message.type !== 'turn') return;
      await handleTurn(message);
    } catch (error) {
      await updateHealth({ state: HEALTH_STATES.ERROR, lastError: safeErrorMessage(error) });
      send({
        type: 'turn.error',
        childId: message?.childId,
        correlation: message?.correlation,
        error: safeErrorMessage(error),
      });
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    socket = null;
    chrome.storage.local.get({ health: defaultHealth() }).then(({ health }) => updateHealth({
      state: HEALTH_STATES.RECOVERING,
      recoveryCount: Number(health?.recoveryCount || 0) + 1,
    })).catch(() => {});
    scheduleReconnect();
  };
  ws.onerror = () => {
    if (socket !== ws) return;
    updateHealth({ state: HEALTH_STATES.ERROR, lastError: 'Family Tutor is unavailable.' }).catch(() => {});
    ws.close();
  };
}

async function waitForBridgeConnected(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { health } = await chrome.storage.local.get({ health: defaultHealth() });
    if (health?.state === HEALTH_STATES.CONNECTED) return;
    if (health?.state === HEALTH_STATES.ERROR && health?.lastError) throw new Error(health.lastError);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Family Tutor authorized, but the bridge did not become connected.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'turn.ack') {
    (async () => {
      const childId = String(message.childId || '').trim();
      const threadUrl = String(message.threadUrl || '').trim();
      const current = await settings();
      const projectId = current.bindings[childId];
      if (projectId && threadUrl && projectIdFromChatGptUrl(threadUrl) === projectId) {
        await chrome.storage.local.set({
          threadUrls: { ...current.threadUrls, [childId]: threadUrl },
        });
      }
      send(message);
    })().catch(() => send(message));
    return;
  }

  if (message?.type === 'turn.error') {
    send({ ...message, error: safeErrorMessage(message.error) });
    return;
  }

  if (message?.type === 'attachment.fetch') {
    (async () => {
      const url = new URL(message.url);
      if (message.token) url.searchParams.set('token', message.token);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('attachment host must be loopback');
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`image download failed (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      respond({ ok: true, base64: btoa(binary), mimeType: response.headers.get('content-type') || message.mimeType || 'application/octet-stream' });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'settings.get') {
    settings().then(({ bindings, threadUrls, health, bridgeUrl, bridgeToken }) => respond({
      bindings: canonicalBindings(bindings), threadUrls, health, bridgeUrl, tokenConfigured: Boolean(bridgeToken),
      version: chrome.runtime.getManifest().version, children: availableChildren,
    })).catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'connection.oauth') {
    (async () => {
      const session = await authorizeExtensionSession({ interactive: true });
      await chrome.storage.local.set({ bridgeUrl: DEFAULT_BRIDGE_URL, bridgeToken: session.accessToken, bridgeRefreshToken: session.refreshToken });
      if (socket) { try { socket.close(); } catch {} socket = null; }
      await updateHealth({ state: HEALTH_STATES.RECOVERING, lastError: null, recoveryCount: 0 });
      await connect();
      await waitForBridgeConnected();
      respond({ ok: true, bridgeUrl: DEFAULT_BRIDGE_URL, tokenConfigured: true });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'connection.configure') {
    (async () => {
      const bridgeUrl = normalizeBridgeUrl(message.bridgeUrl || DEFAULT_BRIDGE_URL);
      const bridgeToken = String(message.bridgeToken || '').trim();
      if (bridgeUrl.startsWith('wss://') && !bridgeToken) throw new Error('Hosted Family Tutor requires a family session token.');
      await chrome.storage.local.set({ bridgeUrl, bridgeToken, bridgeRefreshToken: '' });
      if (socket) { try { socket.close(); } catch {} socket = null; }
      await updateHealth({ state: HEALTH_STATES.RECOVERING, lastError: null });
      await connect();
      respond({ ok: true, bridgeUrl, tokenConfigured: Boolean(bridgeToken) });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'kid.add') {
    (async () => {
      const result = await requestKidAction({ type: 'kid.add', name: String(message.name || '').trim() });
      if (result.child?.id && !availableChildren.some((child) => child.id === result.child.id)) {
        availableChildren = [...availableChildren, { id: String(result.child.id), name: String(result.child.name || result.child.id) }];
        await syncActionHealth((await settings()).health).catch(() => {});
      }
      respond({ ok: true, child: result.child });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'kid.delete') {
    (async () => {
      const childId = String(message.childId || '').trim();
      await requestKidAction({ type: 'kid.delete', childId });
      const current = await settings();
      const bindings = { ...current.bindings };
      const threadUrls = { ...current.threadUrls };
      delete bindings[childId];
      delete threadUrls[childId];
      await chrome.storage.local.set({ bindings, threadUrls });
      await syncActionHealth(current.health).catch(() => {});
      respond({ ok: true });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'assign.currentProject') {
    (async () => {
      const tabId = message.tabId ?? sender.tab?.id;
      const tab = await chrome.tabs.get(tabId);
      const projectId = projectIdFromChatGptUrl(tab.url);
      if (!projectId) throw new Error('this tab is not inside a ChatGPT Project');
      const childId = String(message.childId || '').trim();
      if (!availableChildren.some((child) => child.id === childId)) throw new Error('unknown child');
      const current = await settings();
      const bindings = bindChild(current.bindings, childId, projectId);
      const threadUrls = canonicalThreadUrls(bindings, { ...current.threadUrls, [childId]: tab.url });
      await chrome.storage.local.set({ bindings, threadUrls });
      await reconcileFamilyTabs({ [childId]: tab.id });
      await reportBindings();
      await syncActionHealth((await settings()).health).catch(() => {});
      respond({ ok: true, bindings, projectId, threadUrl: tab.url });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }

  if (message?.type === 'unassign.child') {
    (async () => {
      const { bindings, threadUrls } = await settings();
      const next = { ...bindings };
      const nextThreadUrls = { ...threadUrls };
      delete next[String(message.childId || '')];
      delete nextThreadUrls[String(message.childId || '')];
      await chrome.storage.local.set({ bindings: next, threadUrls: canonicalThreadUrls(next, nextThreadUrls) });
      await reconcileFamilyTabs();
      await syncActionHealth((await settings()).health).catch(() => {});
      respond({ ok: true, bindings: next });
    })().catch((error) => respond({ error: safeErrorMessage(error) }));
    return true;
  }
});

function restoreOnBrowserActivity() {
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    reconcileFamilyTabs({}, { allowCreate: false })
      .then(() => connect())
      .catch((error) => console.error('[family-tutor] browser restore failed', error));
  }, 3000);

  clearTimeout(restoreFallbackTimer);
  restoreFallbackTimer = setTimeout(() => {
    restoreFallbackTimer = null;
    reconcileFamilyTabs()
      .then(() => connect())
      .catch((error) => console.error('[family-tutor] fallback restore failed', error));
  }, 12000);
}

chrome.runtime.onStartup.addListener(restoreOnBrowserActivity);

chrome.windows.onCreated.addListener(() => {
  restoreOnBrowserActivity();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isChatGptUrl(tab?.url)) return;
  restoreOnBrowserActivity();
});

(async () => {
  await applyBootstrap();
  const current = await settings();
  await syncActionHealth(current.health).catch(() => {});
  connect();
  restoreOnBrowserActivity();
})();
