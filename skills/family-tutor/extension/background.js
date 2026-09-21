import { DEFAULT_BRIDGE_URL, bindChild, isChatGptUrl, projectIdFromChatGptUrl, validateTurn } from './protocol.mjs';

const BOOTSTRAP_URL = chrome.runtime.getURL('bootstrap.json');
const GROUP_TITLE = 'family-tutor';
let socket = null;
let availableChildren = [];
let reconnectTimer = null;
let keepAliveTimer = null;
let familyGroupId = null;
let reconcileQueue = Promise.resolve();
let restoreTimer = null;
let restoreFallbackTimer = null;

async function settings() {
  return chrome.storage.local.get({ bindings: {}, threadUrls: {} });
}

async function applyBootstrap() {
  try {
    const response = await fetch(BOOTSTRAP_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const bootstrap = await response.json();
    if (bootstrap?.bindings && typeof bootstrap.bindings === 'object') {
      await chrome.storage.local.set({ bindings: bootstrap.bindings });
    }
  } catch {
    // bootstrap.json is optional and intentionally private when used.
  }
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function reportBindings() {
  const { bindings } = await settings();
  const version = chrome.runtime.getManifest().version;
  for (const childId of Object.keys(bindings)) send({ type: 'tab.bind', childId, version });
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
  socket = new WebSocket(DEFAULT_BRIDGE_URL);
  socket.onopen = async () => {
    await reportBindings();
    clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => send({ type: 'extension.ping' }), 20_000);
  };
  socket.onmessage = async ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
      if (message.type === 'bridge.ready') {
        availableChildren = Array.isArray(message.children) ? message.children.map(String) : [];
        return;
      }
      if (message.type !== 'turn') return;
      await handleTurn(message);
    } catch (error) {
      send({
        type: 'turn.error',
        childId: message?.childId,
        correlation: message?.correlation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  socket.onclose = () => {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    socket = null;
    scheduleReconnect();
  };
  socket.onerror = () => socket?.close();
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
    send(message);
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
    })().catch((error) => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'settings.get') {
    settings().then(({ bindings, threadUrls }) => respond({ bindings, threadUrls, children: availableChildren })).catch((error) => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'assign.currentProject') {
    (async () => {
      const tabId = message.tabId ?? sender.tab?.id;
      const tab = await chrome.tabs.get(tabId);
      const projectId = projectIdFromChatGptUrl(tab.url);
      if (!projectId) throw new Error('this tab is not inside a ChatGPT Project');
      const childId = String(message.childId || '').trim();
      if (!availableChildren.includes(childId)) throw new Error('unknown child');
      const current = await settings();
      const bindings = bindChild(current.bindings, childId, projectId);
      const threadUrls = { ...current.threadUrls, [childId]: tab.url };
      await chrome.storage.local.set({ bindings, threadUrls });
      await reconcileFamilyTabs({ [childId]: tab.id });
      await reportBindings();
      respond({ ok: true, bindings, projectId, threadUrl: tab.url });
    })().catch((error) => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'unassign.child') {
    (async () => {
      const { bindings, threadUrls } = await settings();
      const next = { ...bindings };
      const nextThreadUrls = { ...threadUrls };
      delete next[String(message.childId || '')];
      delete nextThreadUrls[String(message.childId || '')];
      await chrome.storage.local.set({ bindings: next, threadUrls: nextThreadUrls });
      await reconcileFamilyTabs();
      respond({ ok: true, bindings: next });
    })().catch((error) => respond({ error: error.message }));
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
  connect();
  restoreOnBrowserActivity();
})();
