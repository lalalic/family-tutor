import { isChatGptProjectThreadUrl, projectIdFromChatGptUrl } from './protocol.mjs';

const childrenEl = document.querySelector('#children');
const notice = document.querySelector('#notice');
const statusDot = document.querySelector('#status-dot');
const statusLabel = document.querySelector('#status-label');
const kidCount = document.querySelector('#kid-count');
const addKidLink = document.querySelector('#add-kid-link');
const addForm = document.querySelector('#add-form');
const kidName = document.querySelector('#kid-name');
const saveKid = document.querySelector('#save-kid');
const cancelAdd = document.querySelector('#cancel-add');
const reconnect = document.querySelector('#reconnect');
const chatgptConnect = document.querySelector('#chatgpt-connect');
const version = document.querySelector('#version');
const recovery = document.querySelector('#recovery');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const activeProjectId = projectIdFromChatGptUrl(tab?.url);
const activeProjectThread = isChatGptProjectThreadUrl(tab?.url);

function setNotice(message = '', isError = false) {
  notice.textContent = message;
  notice.classList.toggle('show', Boolean(message));
  notice.classList.toggle('error', Boolean(message) && isError);
}

function renderHealth(current) {
  const state = current.health?.state || 'disconnected';
  statusDot.className = `dot ${state}`;
  statusLabel.textContent = state === 'connected'
    ? 'Connected'
    : state === 'recovering'
      ? 'Connecting'
      : state === 'error'
        ? 'Needs attention'
        : 'Offline';
  reconnect.hidden = state !== 'error';
  version.textContent = current.version ? `v${current.version}` : '';
  const attempts = Number(current.health?.recoveryCount || 0);
  recovery.textContent = attempts > 0 ? `${attempts} ${attempts === 1 ? 'retry' : 'retries'}` : '';
  if (current.health?.lastError) setNotice(current.health.lastError, true);
}

async function state() {
  return chrome.runtime.sendMessage({ type: 'settings.get' });
}

async function render() {
  const current = await state();
  renderHealth(current);
  const kids = Array.isArray(current.children) ? current.children : [];
  kidCount.textContent = `${kids.length} kid${kids.length === 1 ? '' : 's'}`;
  const projectAlreadyLinked = Boolean(activeProjectId && Object.values(current.bindings || {}).includes(activeProjectId));
  addKidLink.disabled = !activeProjectThread || projectAlreadyLinked;
  addKidLink.title = !activeProjectThread
    ? 'Open a conversation inside a ChatGPT project to add a kid'
    : projectAlreadyLinked
      ? 'This project is already linked to a kid'
      : 'Add a kid and link this project';
  if (addKidLink.disabled) closeAddForm();
  childrenEl.replaceChildren();

  if (!kids.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No kids yet.';
    childrenEl.append(empty);
    return;
  }

  for (const kid of kids) {
    const childId = kid.id;
    const linkedProject = current.bindings?.[childId] || null;
    const linkedHere = Boolean(activeProjectId && linkedProject === activeProjectId);
    const linkedElsewhere = Boolean(linkedProject && !linkedHere);

    const row = document.createElement('div');
    row.className = 'kid';

    const name = document.createElement('div');
    name.className = 'kid-name';
    name.textContent = kid.name || childId;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const link = document.createElement('button');
    link.className = `icon-btn${linkedHere ? ' linked' : linkedElsewhere ? ' previously-linked' : ''}`;
    link.type = 'button';
    link.textContent = linkedHere ? '✓' : '🔗';
    link.title = linkedHere
      ? 'Linked to this project'
      : activeProjectId
        ? linkedElsewhere ? 'Relink to this project' : 'Link to this project'
        : 'Open a ChatGPT project to link this kid';
    link.disabled = !activeProjectId || linkedHere;
    link.addEventListener('click', async () => {
      link.disabled = true;
      const result = await chrome.runtime.sendMessage({
        type: 'assign.currentProject',
        tabId: tab?.id,
        childId,
      });
      if (result?.error) {
        setNotice(result.error, true);
        link.disabled = false;
        return;
      }
      setNotice('');
      await render();
    });

    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.type = 'button';
    remove.textContent = '🗑';
    remove.title = `Delete ${kid.name || childId} from Family Tutor`;
    remove.addEventListener('click', async () => {
      const confirmed = confirm(`Delete ${kid.name || childId} from Family Tutor? Their Discord history will not be deleted.`);
      if (!confirmed) return;
      remove.disabled = true;
      const result = await chrome.runtime.sendMessage({ type: 'kid.delete', childId });
      if (result?.error) {
        setNotice(result.error, true);
        remove.disabled = false;
        return;
      }
      setNotice('');
      await render();
    });

    actions.append(link, remove);
    row.append(name, actions);
    childrenEl.append(row);
  }
}

function closeAddForm() {
  addForm.classList.remove('show');
  kidName.value = '';
}

addKidLink.addEventListener('click', () => {
  if (addKidLink.disabled) return;
  addForm.classList.add('show');
  kidName.focus();
});

cancelAdd.addEventListener('click', closeAddForm);

saveKid.addEventListener('click', async () => {
  const name = kidName.value.trim();
  if (!name) {
    kidName.focus();
    return;
  }
  saveKid.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'kid.add', name });
  if (result?.error) {
    saveKid.disabled = false;
    setNotice(result.error, true);
    return;
  }
  const childId = result.child?.id;
  if (!childId) {
    saveKid.disabled = false;
    setNotice('Could not add the kid.', true);
    return;
  }
  const linked = await chrome.runtime.sendMessage({ type: 'assign.currentProject', tabId: tab?.id, childId });
  saveKid.disabled = false;
  if (linked?.error) {
    setNotice(linked.error, true);
    return;
  }
  closeAddForm();
  setNotice('');
  await render();
});

kidName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveKid.click();
  if (event.key === 'Escape') closeAddForm();
});


chatgptConnect.addEventListener('click', async () => {
  chatgptConnect.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'chatgpt.authToken' });
  chatgptConnect.disabled = false;
  if (result?.error || !result?.authToken) {
    setNotice(result?.error || 'Could not prepare ChatGPT connection.', true);
    return;
  }
  await navigator.clipboard.writeText(result.authToken);
  setNotice('ChatGPT auth token copied. Paste it into the Family Tutor authentication field in ChatGPT.');
});

reconnect.addEventListener('click', async () => {
  reconnect.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'connection.oauth' });
  reconnect.disabled = false;
  if (result?.error) {
    setNotice(result.error, true);
    return;
  }
  setNotice('');
  await render();
});

await render();
