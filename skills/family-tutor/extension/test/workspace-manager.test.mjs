import assert from 'node:assert/strict';
import test from 'node:test';

import { isChatGptUrl, projectIdFromChatGptUrl } from '../protocol.mjs';
import { FamilyWorkspaceManager, createRestoreDebouncer } from '../workspace-manager.mjs';

function fakeChrome({ tabs = [], groups = [] } = {}) {
  const state = {
    tabs: new Map(tabs.map((tab) => [tab.id, { status: 'complete', active: false, lastAccessed: 0, windowId: 1, groupId: -1, ...tab }])),
    groups: new Map(groups.map((group) => [group.id, { collapsed: false, windowId: 1, ...group }])),
    nextTabId: Math.max(100, ...tabs.map((tab) => tab.id + 1)),
    nextGroupId: Math.max(10, ...groups.map((group) => group.id + 1)),
    createCount: 0,
  };

  function cleanGroups() {
    for (const [id] of state.groups) {
      if (![...state.tabs.values()].some((tab) => tab.groupId === id)) state.groups.delete(id);
    }
  }

  const chrome = {
    tabGroups: {
      async query(query = {}) {
        return [...state.groups.values()].filter((group) => !query.title || group.title === query.title);
      },
      async get(id) {
        const group = state.groups.get(id);
        if (!group) throw new Error('group not found');
        return { ...group };
      },
      async update(id, patch) {
        const group = state.groups.get(id);
        if (!group) throw new Error('group not found');
        Object.assign(group, patch);
        return { ...group };
      },
    },
    tabs: {
      async query(query = {}) {
        const values = [...state.tabs.values()];
        if (Number.isInteger(query.groupId)) return values.filter((tab) => tab.groupId === query.groupId).map((tab) => ({ ...tab }));
        return values.map((tab) => ({ ...tab }));
      },
      async get(id) {
        const tab = state.tabs.get(id);
        if (!tab) throw new Error('tab not found');
        return { ...tab };
      },
      async create({ url, active = false }) {
        const tab = { id: state.nextTabId++, url, active, lastAccessed: 0, status: 'complete', windowId: 1, groupId: -1 };
        state.tabs.set(tab.id, tab);
        state.createCount += 1;
        return { ...tab };
      },
      async group({ tabIds, groupId }) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        let id = groupId;
        if (!Number.isInteger(id)) {
          id = state.nextGroupId++;
          const first = state.tabs.get(ids[0]);
          state.groups.set(id, { id, title: '', collapsed: false, windowId: first?.windowId ?? 1 });
        }
        for (const tabId of ids) state.tabs.get(tabId).groupId = id;
        cleanGroups();
        return id;
      },
      async move(tabIds, { windowId }) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const moved = ids.map((id) => {
          const tab = state.tabs.get(id);
          tab.windowId = windowId;
          return { ...tab };
        });
        return Array.isArray(tabIds) ? moved : moved[0];
      },
      async ungroup(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) state.tabs.get(id).groupId = -1;
        cleanGroups();
      },
      async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) state.tabs.delete(id);
        cleanGroups();
      },
    },
  };
  return { chrome, state };
}

function manager(chrome) {
  return new FamilyWorkspaceManager(chrome, {
    groupTitle: 'family-tutor',
    isChatGptUrl,
    projectIdFromUrl: projectIdFromChatGptUrl,
  });
}

test('stale saved thread claims an existing project tab instead of creating a duplicate', async () => {
  const { chrome, state } = fakeChrome({
    groups: [{ id: 1, title: 'family-tutor', collapsed: false }],
    tabs: [{ id: 10, groupId: 1, url: 'https://chatgpt.com/g/g-p-11111111111111111111111111111111/project' }],
  });
  const result = await manager(chrome).reconcile({
    bindings: { sammy: 'g-p-11111111111111111111111111111111' },
    threadUrls: { sammy: 'https://chatgpt.com/g/g-p-11111111111111111111111111111111/project/c/old-thread' },
  });
  assert.equal(state.createCount, 0);
  assert.equal(result.childTabs.sammy, 10);
  assert.equal(state.groups.get(1).collapsed, true);
});

test('duplicate groups converge to one collapsed group with exactly one tab per child', async () => {
  const { chrome, state } = fakeChrome({
    groups: [
      { id: 1, title: 'family-tutor', collapsed: false },
      { id: 2, title: 'family-tutor', collapsed: false },
    ],
    tabs: [
      { id: 10, groupId: 1, url: 'https://chatgpt.com/g/g-p-11111111111111111111111111111111/project' },
      { id: 11, groupId: 1, url: 'https://chatgpt.com/g/g-p-33333333333333333333333333333333/project' },
      { id: 20, groupId: 2, url: 'https://chatgpt.com/g/g-p-22222222222222222222222222222222/project' },
    ],
  });

  await manager(chrome).reconcile({
    bindings: { sammy: 'g-p-11111111111111111111111111111111', maggie: 'g-p-22222222222222222222222222222222' },
    threadUrls: {},
  });

  const familyGroups = [...state.groups.values()].filter((group) => group.title === 'family-tutor');
  assert.equal(familyGroups.length, 1);
  assert.equal(familyGroups[0].collapsed, true);
  const owned = [...state.tabs.values()].filter((tab) => tab.groupId === familyGroups[0].id);
  assert.deepEqual(owned.map((tab) => projectIdFromChatGptUrl(tab.url)).sort(), ['g-p-11111111111111111111111111111111', 'g-p-22222222222222222222222222222222']);
  assert.equal(state.tabs.get(11).groupId, -1);
});

test('a genuinely missing child creates exactly one tab', async () => {
  const { chrome, state } = fakeChrome({
    groups: [{ id: 1, title: 'family-tutor', collapsed: false }],
    tabs: [{ id: 10, groupId: 1, url: 'https://chatgpt.com/g/g-p-11111111111111111111111111111111/project' }],
  });

  await manager(chrome).reconcile({
    bindings: { sammy: 'g-p-11111111111111111111111111111111', maggie: 'g-p-22222222222222222222222222222222' },
    threadUrls: {},
  });

  assert.equal(state.createCount, 1);
  const owned = [...state.tabs.values()].filter((tab) => tab.groupId === 1);
  assert.equal(owned.length, 2);
  assert.deepEqual(owned.map((tab) => projectIdFromChatGptUrl(tab.url)).sort(), ['g-p-11111111111111111111111111111111', 'g-p-22222222222222222222222222222222']);
});

test('restore debounce waits for the latest browser activity before reconciling', async () => {
  let runs = 0;
  let nextId = 1;
  const pending = new Map();
  const cleared = new Set();
  const schedule = createRestoreDebouncer(async () => { runs += 1; }, {
    delayMs: 3000,
    setTimer(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimer(id) {
      cleared.add(id);
    },
  });

  schedule(); // startup
  schedule(); // restored Tutor tab arrives after startup
  assert.equal(cleared.has(1), true);
  assert.equal(runs, 0);
  await pending.get(2)();
  assert.equal(runs, 1);
});
