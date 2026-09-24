export function sortTabs(tabs) {
  return [...tabs].sort(
    (a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active))
      || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0),
  );
}

export function createRestoreDebouncer(run, {
  delayMs = 3000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let timer = null;
  return () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(async () => {
      timer = null;
      await run();
    }, delayMs);
  };
}

export class FamilyWorkspaceManager {
  constructor(chromeApi, {
    groupTitle,
    isChatGptUrl,
    projectIdFromUrl,
  }) {
    this.chrome = chromeApi;
    this.groupTitle = groupTitle;
    this.isChatGptUrl = isChatGptUrl;
    this.projectIdFromUrl = projectIdFromUrl;
    this.groupId = null;
  }

  async familyGroups() {
    return this.chrome.tabGroups.query({ title: this.groupTitle });
  }

  async primaryGroup() {
    if (Number.isInteger(this.groupId)) {
      try {
        const group = await this.chrome.tabGroups.get(this.groupId);
        if (group?.title === this.groupTitle) return group;
      } catch {}
      this.groupId = null;
    }
    const groups = await this.familyGroups();
    const group = groups[0] || null;
    this.groupId = Number.isInteger(group?.id) ? group.id : null;
    return group;
  }

  async ensureGroup(seedTabId) {
    let group = await this.primaryGroup();
    if (!group) {
      if (!Number.isInteger(seedTabId)) return null;
      const id = await this.chrome.tabs.group({ tabIds: [seedTabId] });
      group = await this.chrome.tabGroups.update(id, { title: this.groupTitle, collapsed: true });
      this.groupId = id;
      return group;
    }

    const duplicates = (await this.familyGroups()).filter((item) => item.id !== group.id);
    for (const duplicate of duplicates) {
      const tabs = await this.chrome.tabs.query({ groupId: duplicate.id });
      const ids = tabs.map((tab) => tab.id).filter(Number.isInteger);
      if (!ids.length) continue;
      await this.chrome.tabs.move(ids, { windowId: group.windowId, index: -1 });
      await this.chrome.tabs.group({ groupId: group.id, tabIds: ids });
    }
    await this.chrome.tabGroups.update(group.id, { title: this.groupTitle, collapsed: true });
    return group;
  }

  async putTab(tabId, group = null) {
    if (!Number.isInteger(tabId)) throw new Error('invalid ChatGPT tab');
    let tab = await this.chrome.tabs.get(tabId);
    group ||= await this.ensureGroup(tabId);
    if (!group) throw new Error('could not create family-tutor tab group');

    if (tab.windowId !== group.windowId) {
      const moved = await this.chrome.tabs.move(tab.id, { windowId: group.windowId, index: -1 });
      tab = Array.isArray(moved) ? moved[0] : moved;
    }
    if (tab.groupId !== group.id) await this.chrome.tabs.group({ groupId: group.id, tabIds: [tab.id] });
    return this.chrome.tabs.get(tab.id);
  }

  async allChatGptTabs() {
    const tabs = await this.chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    return tabs.filter((tab) => Number.isInteger(tab.id) && this.isChatGptUrl(tab.url));
  }

  async createProjectTab(projectId, threadUrl = null) {
    const url = threadUrl && this.projectIdFromUrl(threadUrl) === projectId
      ? threadUrl
      : `https://chatgpt.com/g/${projectId}/project`;
    const tab = await this.chrome.tabs.create({ url, active: false });
    if (!Number.isInteger(tab?.id)) throw new Error('could not open ChatGPT project tab');
    return tab;
  }

  async waitForExactThread(threadUrl, timeoutMs = 6000) {
    if (!threadUrl) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tabs = await this.allChatGptTabs();
      const exact = sortTabs(tabs.filter((tab) => tab.url === threadUrl))[0] || null;
      if (exact) return exact;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async resolveProjectTab(projectId) {
    const group = await this.primaryGroup();
    if (!group) return null;
    const tabs = await this.chrome.tabs.query({ groupId: group.id });
    return sortTabs(
      tabs.filter(
        (tab) => tab.status === 'complete'
          && this.isChatGptUrl(tab.url)
          && this.projectIdFromUrl(tab.url) === projectId,
      ),
    )[0] || null;
  }

  chooseExistingTab({ allTabs, childId, projectId, threadUrl, preferredTabs }) {
    const preferredId = preferredTabs[childId];
    if (Number.isInteger(preferredId)) {
      const preferred = allTabs.find((tab) => tab.id === preferredId);
      if (preferred && this.projectIdFromUrl(preferred.url) === projectId) return preferred;
    }
    if (threadUrl) {
      const exact = sortTabs(allTabs.filter((tab) => tab.url === threadUrl))[0];
      if (exact) return exact;
    }
    return sortTabs(allTabs.filter((tab) => this.projectIdFromUrl(tab.url) === projectId))[0] || null;
  }

  async reconcile({ bindings, threadUrls, preferredTabs = {}, allowCreate = true }) {
    const entries = Object.entries(bindings);
    if (!entries.length) {
      for (const group of await this.familyGroups()) {
        const tabs = await this.chrome.tabs.query({ groupId: group.id });
        const ids = tabs.map((tab) => tab.id).filter(Number.isInteger);
        if (ids.length) await this.chrome.tabs.ungroup(ids);
      }
      this.groupId = null;
      return { childTabs: {}, threadUrls };
    }

    let allTabs = await this.allChatGptTabs();
    let seed = null;
    for (const [childId, projectId] of entries) {
      seed = this.chooseExistingTab({
        allTabs,
        childId,
        projectId,
        threadUrl: threadUrls[childId],
        preferredTabs,
      });
      if (seed) break;
    }
    if (!seed && allowCreate) seed = await this.createProjectTab(entries[0][1], threadUrls[entries[0][0]]);
    if (!seed) return { childTabs: {}, threadUrls };

    const group = await this.ensureGroup(seed.id);
    const chosen = new Set();
    const childTabs = {};
    const discoveredThreadUrls = { ...threadUrls };

    for (const [childId, projectId] of entries) {
      allTabs = (await this.allChatGptTabs()).filter((tab) => !chosen.has(tab.id));
      let tab = this.chooseExistingTab({
        allTabs,
        childId,
        projectId,
        threadUrl: threadUrls[childId],
        preferredTabs,
      });
      if (!tab && allowCreate) tab = await this.createProjectTab(projectId, threadUrls[childId]);
      if (!tab) continue;

      tab = await this.putTab(tab.id, group);
      chosen.add(tab.id);
      childTabs[childId] = tab.id;
      try {
        const currentUrl = new URL(tab.url);
        if (this.projectIdFromUrl(tab.url) === projectId && currentUrl.pathname.includes('/c/')) {
          discoveredThreadUrls[childId] = tab.url;
        }
      } catch {}
    }

    const grouped = await this.chrome.tabs.query({ groupId: group.id });
    const extras = grouped.map((tab) => tab.id).filter((id) => Number.isInteger(id) && !chosen.has(id));
    if (extras.length) await this.chrome.tabs.ungroup(extras);

    const allAfter = await this.allChatGptTabs();
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
    if (duplicateIds.length) await this.chrome.tabs.remove([...new Set(duplicateIds)]);

    await this.chrome.tabGroups.update(group.id, { title: this.groupTitle, collapsed: true });
    return { childTabs, threadUrls: discoveredThreadUrls };
  }
}
