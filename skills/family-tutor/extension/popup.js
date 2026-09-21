import { projectIdFromChatGptUrl } from './protocol.mjs';

const project = document.querySelector('#project');
const children = document.querySelector('#children');
const status = document.querySelector('#status');
const health = document.querySelector('#health');
const connectFamily = document.querySelector('#connect-family');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const projectId = projectIdFromChatGptUrl(tab?.url);
const current = await chrome.runtime.sendMessage({ type: 'settings.get' });
connectFamily.hidden = current.health?.state !== 'error';
project.textContent = projectId ? `${tab?.title || 'ChatGPT Project'}\n${projectId}` : 'Open a ChatGPT Project first.';

function renderHealth(current) {
  const state = current.health?.state || 'unknown';
  const detail = current.health?.lastError ? `\n${current.health.lastError}` : '';
  const recoveryCount = Number(current.health?.recoveryCount || 0);
  health.textContent = `Extension ${current.version || 'unknown'} · bridge ${state} · recoveries ${recoveryCount}${detail}`;
}

function render(bindings) {
  children.replaceChildren();
  for (const childId of current.children || []) {
    const row = document.createElement('div');
    row.className = 'child';
    const assign = document.createElement('button');
    const assigned = bindings?.[childId];
    const assignedThreadUrl = current.threadUrls?.[childId];
    assign.textContent = assignedThreadUrl === tab?.url
      ? `✓ ${childId} — this thread`
      : assigned === projectId
        ? `${childId} — another thread in this project`
        : assigned
          ? `${childId} — assigned elsewhere`
          : `Assign this thread to ${childId}`;
    assign.disabled = !projectId;
    assign.addEventListener('click', async () => {
      const result = await chrome.runtime.sendMessage({ type: 'assign.currentProject', tabId: tab?.id, childId });
      status.textContent = result.error || `Assigned this thread tab to ${childId}.`;
      if (!result.error) render(result.bindings);
    });
    row.append(assign);

    if (assigned) {
      const clear = document.createElement('button');
      clear.className = 'clear';
      clear.textContent = '×';
      clear.title = `Unassign ${childId}`;
      clear.addEventListener('click', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'unassign.child', childId });
        status.textContent = result.error || `Unassigned ${childId}.`;
        if (!result.error) render(result.bindings);
      });
      row.append(clear);
    }
    children.append(row);
  }
  if (!(current.children || []).length) status.textContent = 'Family Tutor bridge is not connected yet.';
}

render(current.bindings || {});
renderHealth(current);


connectFamily.addEventListener('click', async () => {
  connectFamily.disabled = true;
  status.textContent = 'Connecting Family Tutor…';
  const result = await chrome.runtime.sendMessage({ type: 'connection.oauth' });
  status.textContent = result.error || 'Family Tutor connected.';
  if (!result.error) connectFamily.hidden = true;
  connectFamily.disabled = false;
});
