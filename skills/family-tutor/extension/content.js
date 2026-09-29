let activeCorrelationId = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function promptTextMatches(observed, expected) {
  const observedText = normalized(observed);
  const expectedText = normalized(expected);
  if (observedText.includes(expectedText)) return true;
  if (!expectedText) return !observedText;
  const span = Math.min(256, Math.max(48, Math.floor(expectedText.length / 8)));
  return observedText.length >= Math.floor(expectedText.length * 0.9)
    && observedText.includes(expectedText.slice(0, span))
    && observedText.includes(expectedText.slice(-span));
}
const userTurns = () => [...document.querySelectorAll('[data-message-author-role="user"], [data-user-message-bubble="true"]')]
  .map((element) => ({ text: element.innerText?.trim() || '', id: element.getAttribute('data-message-id') || '' }))
  .filter((turn) => turn.text);
const assistantTurnCount = () => document.querySelectorAll('[data-message-author-role="assistant"]').length;
const userTurnCount = () => Math.max(
  document.querySelectorAll('[data-message-author-role="user"]').length,
  document.querySelectorAll('[data-user-message-bubble="true"]').length,
  document.querySelectorAll('button[aria-label="Edit message"]').length,
);

function composer() {
  return document.querySelector('#prompt-textarea')
    || document.querySelector('[contenteditable="true"][data-composer-markdown]')
    || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
    || document.querySelector('textarea[data-id="root"]')
    || document.querySelector('textarea[placeholder]');
}

function composerText(field) {
  if (field instanceof HTMLTextAreaElement) return normalized(field.value);
  return normalized(field?.innerText || field?.textContent);
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
  if (!inserted || !composerText(field).includes(normalized(text))) {
    field.textContent = text;
  }
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

async function waitForUserTurn(prompt, previousTurnCount, previousUserTurnCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let clearedPolls = 0;
  while (Date.now() < deadline) {
    const turns = userTurns();
    for (const turn of turns.slice(previousUserTurnCount)) {
      if (promptTextMatches(turn.text, prompt)) return turn;
    }
    const currentComposerText = composerText(composer());
    if (userTurnCount() > previousTurnCount && !promptTextMatches(currentComposerText, prompt)) {
      return { text: normalized(prompt), id: '' };
    }
    if (!currentComposerText.trim()) {
      clearedPolls += 1;
      if (clearedPolls >= 2) return { text: normalized(prompt), id: '' };
    } else {
      clearedPolls = 0;
    }
    await sleep(250);
  }
  throw new Error('submitted prompt was not accepted by ChatGPT');
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
  const value = String(instructions || '').trim();
  if (!value) throw new Error('Project Instructions template is empty.');
  const menu = candidateByText('button,[role="button"]', ['project settings', 'edit project', 'project instructions']);
  if (menu) menu.click();
  const panel = await waitFor(() => document.querySelector('[role="dialog"]') || document.querySelector('form'), 'ChatGPT Project settings', 10000);
  const field = await waitFor(() => panel.querySelector('textarea, [contenteditable="true"]'), 'ChatGPT Project Instructions field', 10000);
  fillComposer(field, value);
  const save = candidateByText('button,[role="button"]', ['save', 'done', 'update'], panel);
  if (!save) throw new Error('ChatGPT Project Instructions save button not found.');
  save.click();
  return { applied: true };
}

async function ensureProject(projectName) {
  const name = normalized(projectName);
  if (!name) throw new Error('kid name is required');

  const existing = [...document.querySelectorAll('a[href]')].find((anchor) => {
    const label = normalized(anchor.innerText || anchor.textContent);
    return label.toLowerCase() === name.toLowerCase() && /\/g\/g-p-[^/]+\/project/.test(anchor.getAttribute('href') || '');
  });
  if (existing) {
    const absolute = new URL(existing.getAttribute('href'), location.origin).href;
    const match = absolute.match(/\/g\/(g-p-[A-Fa-f0-9]{32})(?:[-\/]|$)/);
    if (match) return { projectId: match[1], projectUrl: absolute, reused: true };
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
    if (match) return { projectId: match[1], projectUrl: location.href, reused: false };
    const linked = [...document.querySelectorAll('a[href]')].find((anchor) => normalized(anchor.innerText || anchor.textContent).toLowerCase() === name.toLowerCase());
    if (linked) {
      const absolute = new URL(linked.getAttribute('href'), location.origin).href;
      const linkedMatch = absolute.match(/\/g\/(g-p-[A-Fa-f0-9]{32})(?:[-\/]|$)/);
      if (linkedMatch) return { projectId: linkedMatch[1], projectUrl: absolute, reused: false };
    }
    await sleep(250);
  }
  throw new Error(`Project ${name} was not created. Finish it in ChatGPT, then run Setup for me again.`);
}


async function reportTurnStatus(message, stage, error = null) {
  await chrome.runtime.sendMessage({
    type: 'turn.status', childId: message.childId, correlation: message.correlation, stage,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  }).catch(() => {});
}

async function watchResponseComplete(message, previousAssistantCount, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let stablePolls = 0;
  while (Date.now() < deadline) {
    if (assistantTurnCount() > previousAssistantCount && !isGenerating()) {
      stablePolls += 1;
      if (stablePolls >= 2) {
        await chrome.runtime.sendMessage({ type: 'turn.response_complete', childId: message.childId, correlation: message.correlation }).catch(() => {});
        return;
      }
    } else stablePolls = 0;
    await sleep(500);
  }
}

async function submitDeliveryReminder(message) {
  const correlationId = String(message.correlation?.correlationId || '').trim();
  if (!correlationId) throw new Error('delivery reminder correlation id is required');
  await waitForIdle();
  const field = await waitFor(composer, 'ChatGPT composer');
  const reminder = `<FAMILY_TUTOR_DELIVERY_REMINDER>\n${JSON.stringify({ correlationId })}\n</FAMILY_TUTOR_DELIVERY_REMINDER>\nYour previous answer is complete but has not been delivered. Call reply_to_discord now with this correlationId, the already-completed answer, and final=true. Do not answer only in the ChatGPT page.`;
  fillComposer(field, reminder);
  const button = await waitFor(() => {
    const candidate = sendButton();
    return candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true' ? candidate : null;
  }, 'enabled ChatGPT send button');
  button.click();
}

async function submitTurn(message) {
  const correlationId = message.correlation.correlationId;
  if (activeCorrelationId) throw new Error(`tab already processing turn ${activeCorrelationId}`);
  activeCorrelationId = correlationId;
  try {
    await waitForIdle();
    for (const attachment of message.attachments || []) await uploadAttachment(attachment);
    const field = await waitFor(composer, 'ChatGPT composer');
    const previousTurnCount = userTurnCount();
    const previousUserTurnCount = userTurns().length;
    const previousAssistantCount = assistantTurnCount();
    await reportTurnStatus(message, 'tab_ready');
    fillComposer(field, message.prompt);
    await waitFor(
      () => promptTextMatches(composerText(field), message.prompt),
      'ChatGPT composer text',
      15000,
    );
    const button = await waitFor(() => {
      const candidate = sendButton();
      return candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true' ? candidate : null;
    }, 'enabled ChatGPT send button');
    button.click();
    await reportTurnStatus(message, 'prompt_submitted');
    await sleep(500);
    if (promptTextMatches(composerText(composer()), message.prompt)) {
      const form = button.closest('form');
      if (form?.requestSubmit) form.requestSubmit(button);
    }
    const turn = await waitForUserTurn(message.prompt, previousTurnCount, previousUserTurnCount);
    await reportTurnStatus(message, 'prompt_acked');
    await chrome.runtime.sendMessage({
      type: 'turn.ack',
      childId: message.childId,
      correlation: message.correlation,
      threadUrl: location.href,
    });
    watchResponseComplete(message, previousAssistantCount).catch(() => {});
    return turn;
  } finally {
    activeCorrelationId = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'setup.project.ensure') {
    ensureProject(message.name).then((result) => respond({ ok: true, ...result })).catch((error) => respond({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'setup.project.instructions') {
    applyProjectInstructions(message.instructions).then((result) => respond({ ok: true, ...result })).catch((error) => respond({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'turn.delivery.required') {
    submitDeliveryReminder(message).then(() => respond({ accepted: true, version: chrome.runtime.getManifest().version })).catch((error) => respond({ accepted: false, version: chrome.runtime.getManifest().version, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type !== 'turn') return;
  submitTurn(message).then(() => respond({
    accepted: true,
    version: chrome.runtime.getManifest().version,
  })).catch(async (error) => {
    const errorText = error instanceof Error ? error.message : String(error);
    await chrome.runtime.sendMessage({
      type: 'turn.error',
      childId: message.childId,
      correlation: message.correlation,
      error: errorText,
    });
    respond({ accepted: false, version: chrome.runtime.getManifest().version, error: errorText });
  });
  return true;
});
