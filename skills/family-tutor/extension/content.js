let activeCorrelationId = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const userTurns = () => [...document.querySelectorAll('[data-message-author-role="user"]')]
  .map((element) => ({ text: element.innerText?.trim() || '', id: element.getAttribute('data-message-id') || '' }))
  .filter((turn) => turn.text);

function composer() {
  return document.querySelector('#prompt-textarea')
    || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
    || document.querySelector('textarea[data-id="root"]')
    || document.querySelector('textarea[placeholder]');
}

function composerText(field) {
  return normalized(field?.innerText ?? field?.textContent ?? field?.value);
}

function fileInput() {
  return document.querySelector('input[type="file"]');
}

function sendButton() {
  return document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i], form button[type="submit"]');
}

function isGenerating() {
  return Boolean(document.querySelector(
    'button[data-testid="stop-button"], button[aria-label*="Stop generating" i], button[aria-label="Stop" i]',
  ));
}

async function waitForIdle(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isGenerating()) return;
    await sleep(250);
  }
  throw new Error('ChatGPT did not become idle');
}

function attachmentNames() {
  return [...document.querySelectorAll('button[aria-label^="Remove file"]')]
    .map((button) => (button.getAttribute('aria-label') || '').replace(/^Remove file\s+\d+:\s*/, ''))
    .filter(Boolean);
}

async function waitFor(find, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = find();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`${label} not found`);
}

async function uploadAttachment(attachment) {
  const fetched = await chrome.runtime.sendMessage({
    type: 'attachment.fetch',
    url: attachment.url,
    token: attachment.token,
    mimeType: attachment.mimeType,
  });
  if (!fetched?.ok || !fetched.base64) throw new Error(fetched?.error || 'image download failed');
  const binary = atob(fetched.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: fetched.mimeType || attachment.mimeType });
  const input = await waitFor(fileInput, 'ChatGPT attachment input');
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], attachment.name, { type: attachment.mimeType }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => attachmentNames().includes(attachment.name), `ChatGPT attachment ${attachment.name}`, 30000);
}

function fillComposer(field, text) {
  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, text);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand('insertText', false, text);
  selection?.removeAllRanges();
  if (!inserted) field.textContent = text;
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

async function waitForUserTurn(prompt, timeoutMs = 30000) {
  const wanted = normalized(prompt);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const turn of userTurns()) {
      if (normalized(turn.text).includes(wanted)) return turn;
    }
    await sleep(250);
  }
  throw new Error('submitted prompt did not become a durable ChatGPT user turn');
}


function clickableText(value) {
  return normalized(value).toLowerCase();
}

function candidateByText(selector, patterns, root = document) {
  const wanted = patterns.map((value) => value.toLowerCase());
  return [...root.querySelectorAll(selector)].find((element) => {
    const text = clickableText(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
    return wanted.some((pattern) => text === pattern || text.includes(pattern));
  }) || null;
}

async function applyProjectInstructions(instructions) {
  const menu = candidateByText('button,[role="button"]', ['project settings', 'edit project', 'project instructions']);
  if (menu) menu.click();
  const panel = await waitFor(() => document.querySelector('[role="dialog"]') || document.querySelector('form'), 'ChatGPT Project settings', 10000);
  const field = await waitFor(() => panel.querySelector('textarea, [contenteditable="true"], input[type="text"]'), 'ChatGPT Project Instructions field', 10000);
  fillComposer(field, instructions);
  const save = candidateByText('button,[role="button"]', ['save', 'done', 'update'], panel);
  if (!save) throw new Error('ChatGPT Project Instructions save button not found.');
  save.click();
}

async function ensureProject(projectName, instructions = '') {
  const name = normalized(projectName);
  if (!name) throw new Error('kid name is required');

  const existing = [...document.querySelectorAll('a[href]')].find((anchor) => {
    const label = normalized(anchor.innerText || anchor.textContent);
    return label.toLowerCase() === name.toLowerCase() && /\/g\/g-p-[^/]+\/project/.test(anchor.getAttribute('href') || '');
  });
  if (existing) {
    const absolute = new URL(existing.getAttribute('href'), location.origin).href;
    const match = absolute.match(/\/g\/(g-p-[A-Fa-f0-9]{32})(?:[-\/]|$)/);
    if (match) {
      if (instructions) {
        existing.click();
        await waitFor(() => location.pathname.includes(`/g/${match[1]}`), 'ChatGPT Project page', 15000);
        await applyProjectInstructions(instructions);
      }
      return { projectId: match[1], projectUrl: absolute, reused: true };
    }
  }

  const newProject = candidateByText('button,a,[role="button"]', ['new project', 'create project']);
  if (!newProject) throw new Error(`Open ChatGPT and create a Project named ${name}, then run Setup for me again.`);
  newProject.click();

  const dialog = await waitFor(() => document.querySelector('[role="dialog"]') || document.querySelector('form'), 'ChatGPT New Project dialog', 10000);
  const input = await waitFor(() => dialog.querySelector('input[type="text"], input:not([type]), textarea'), 'ChatGPT project name field', 10000);
  input.focus();
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(input, name);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: name }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const create = await waitFor(() => candidateByText('button,[role="button"]', ['create', 'continue', 'done'], dialog), 'ChatGPT Create Project button', 10000);
  create.click();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const match = location.pathname.match(/\/g\/(g-p-[A-Fa-f0-9]{32})(?:[-\/]|$)/);
    if (match) {
      if (instructions) await applyProjectInstructions(instructions);
      return { projectId: match[1], projectUrl: location.href, reused: false };
    }
    const linked = [...document.querySelectorAll('a[href]')].find((anchor) => normalized(anchor.innerText || anchor.textContent).toLowerCase() === name.toLowerCase());
    if (linked) {
      const absolute = new URL(linked.getAttribute('href'), location.origin).href;
      const linkedMatch = absolute.match(/\/g\/(g-p-[A-Fa-f0-9]{32})(?:[-\/]|$)/);
      if (linkedMatch) {
        if (instructions) {
          linked.click();
          await waitFor(() => location.pathname.includes(`/g/${linkedMatch[1]}`), 'ChatGPT Project page', 15000);
          await applyProjectInstructions(instructions);
        }
        return { projectId: linkedMatch[1], projectUrl: absolute, reused: false };
      }
    }
    await sleep(250);
  }
  throw new Error(`Project ${name} was not created. Finish it in ChatGPT, then run Setup for me again.`);
}

async function submitTurn(message) {
  const correlationId = message.correlation.correlationId;
  if (activeCorrelationId) throw new Error(`tab already processing turn ${activeCorrelationId}`);
  activeCorrelationId = correlationId;
  try {
    await waitForIdle();
    for (const attachment of message.attachments || []) await uploadAttachment(attachment);
    const field = await waitFor(composer, 'ChatGPT composer');
    fillComposer(field, message.prompt);
    await waitFor(
      () => composerText(field).includes(normalized(message.prompt)),
      'ChatGPT composer text',
      15000,
    );
    const button = await waitFor(() => {
      const candidate = sendButton();
      return candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true' ? candidate : null;
    }, 'enabled ChatGPT send button');
    button.click();
    const turn = await waitForUserTurn(message.prompt);
    await chrome.runtime.sendMessage({
      type: 'turn.ack',
      childId: message.childId,
      correlation: message.correlation,
      threadUrl: location.href,
    });
    return turn;
  } finally {
    activeCorrelationId = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'setup.project.ensure') {
    ensureProject(message.name, message.instructions).then((result) => respond({ ok: true, ...result })).catch((error) => respond({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type !== 'turn') return;
  submitTurn(message).catch((error) => chrome.runtime.sendMessage({
    type: 'turn.error',
    childId: message.childId,
    correlation: message.correlation,
    error: error instanceof Error ? error.message : String(error),
  }));
});
