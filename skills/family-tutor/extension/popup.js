import { projectIdFromChatGptUrl } from './protocol.mjs';

const childrenEl = document.querySelector('#children');
const notice = document.querySelector('#notice');
const connectFamily = document.querySelector('#connect-family');
const projectTitle = document.querySelector('#project-title');
const projectIdEl = document.querySelector('#project-id');
const kidsSummary = document.querySelector('#kids-summary');
const statusDot = document.querySelector('#status-dot');
const statusLabel = document.querySelector('#status-label');
const version = document.querySelector('#version');
const recovery = document.querySelector('#recovery');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const activeProjectId = projectIdFromChatGptUrl(tab?.url);

function setNotice(message = '', isError = false) {
  notice.textContent = message;
  notice.classList.toggle('show', Boolean(message));
  notice.classList.toggle('error', Boolean(message) && isError);
}

function renderHealth(current) {
  const state = current.health?.state || 'disconnected';
  statusDot.className = `status-dot ${state}`;
  statusLabel.textContent = state === 'connected'
    ? 'Connected'
    : state === 'recovering'
      ? 'Connecting'
      : state === 'error'
        ? 'Needs attention'
        : 'Disconnected';
  connectFamily.hidden = state !== 'error';
  version.textContent = `Version ${current.version || 'unknown'}`;
  const count = Number(current.health?.recoveryCount || 0);
  recovery.textContent = count > 0 ? `${count} reconnect attempt${count === 1 ? '' : 's'}` : '';
  if (current.health?.lastError) setNotice(current.health.lastError, true);
}

function renderProject() {
  if (!activeProjectId) {
    projectTitle.textContent = 'Open a ChatGPT Project to assign it';
    projectIdEl.textContent = '';
    return;
  }
  projectTitle.textContent = tab?.title || 'ChatGPT Project';
  projectIdEl.textContent = activeProjectId;
}

function childState(current, childId) {
  const project = current.bindings?.[childId];
  const threadUrl = current.threadUrls?.[childId];
  if (!project) return { label: 'Not configured', action: 'Assign', current: false };
  if (threadUrl && threadUrl === tab?.url) return { label: 'Assigned to this thread', action: 'Assigned', current: true };
  if (project === activeProjectId) return { label: 'Assigned to another thread in this project', action: 'Use this thread', current: false };
  return { label: 'Assigned to another project', action: 'Move here', current: false };
}

async function loadState() {
  return chrome.runtime.sendMessage({ type: 'settings.get' });
}

async function render() {
  const current = await loadState();
  renderHealth(current);
  renderProject();

  const childIds = Array.isArray(current.children) ? current.children : [];
  const configured = childIds.filter((childId) => Boolean(current.bindings?.[childId])).length;
  kidsSummary.textContent = `${configured} of ${childIds.length} configured`;

  childrenEl.replaceChildren();
  if (!childIds.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = current.health?.state === 'connected'
      ? 'No kids are configured for this family yet.'
      : 'Waiting for Family Tutor to connect…';
    childrenEl.append(empty);
    return;
  }

  for (const childId of childIds) {
    const state = childState(current, childId);
    const row = document.createElement('div');
    row.className = 'kid';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = String(childId).trim().slice(0, 1) || '?';

    const copy = document.createElement('div');
    copy.className = 'kid-copy';
    const name = document.createElement('div');
    name.className = 'kid-name';
    name.textContent = childId;
    const detail = document.createElement('div');
    detail.className = 'kid-state';
    detail.textContent = state.label;
    copy.append(name, detail);

    const actions = document.createElement('div');
    actions.className = 'kid-actions';

    const assign = document.createElement('button');
    assign.className = state.current ? 'secondary' : 'primary';
    assign.textContent = state.action;
    assign.disabled = !activeProjectId || state.current;
    assign.addEventListener('click', async () => {
      assign.disabled = true;
      setNotice('Updating assignment…');
      const result = await chrome.runtime.sendMessage({
        type: 'assign.currentProject',
        tabId: tab?.id,
        childId,
      });
      if (result?.error) {
        setNotice(result.error, true);
        assign.disabled = false;
        return;
      }
      setNotice(`${childId} is now assigned to this ChatGPT thread.`);
      await render();
    });
    actions.append(assign);

    if (current.bindings?.[childId]) {
      const remove = document.createElement('button');
      remove.className = 'link-button';
      remove.textContent = 'Remove';
      remove.title = `Remove ${childId} assignment`;
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        const result = await chrome.runtime.sendMessage({ type: 'unassign.child', childId });
        if (result?.error) {
          setNotice(result.error, true);
          remove.disabled = false;
          return;
        }
        setNotice(`${childId} assignment removed.`);
        await render();
      });
      actions.append(remove);
    }

    row.append(avatar, copy, actions);
    childrenEl.append(row);
  }
}

connectFamily.addEventListener('click', async () => {
  connectFamily.disabled = true;
  setNotice('Reconnecting Family Tutor…');
  const result = await chrome.runtime.sendMessage({ type: 'connection.oauth' });
  if (result?.error) {
    setNotice(result.error, true);
    connectFamily.disabled = false;
    return;
  }
  setNotice('Family Tutor connected.');
  connectFamily.hidden = true;
  connectFamily.disabled = false;
  await render();
});

await render();
