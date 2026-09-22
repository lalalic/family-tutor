import { bindChild, canonicalThreadUrls } from './protocol.mjs';

export const CHATGPT_DEVELOPER_MODE_URL = 'https://chatgpt.com/#settings/Apps';

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.status === 'complete') return tab;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('ChatGPT did not finish loading.');
}

export async function setupKidProjects({
  children,
  current,
  getSettings,
  save,
  reconcile,
  report,
  syncHealth,
  getLearnerProfileTemplate,
}) {
  const missing = children.filter((child) => !current.bindings?.[child.id]);
  if (!missing.length) return { linked: children.length, created: 0, reused: 0 };

  const tab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: true });
  if (!Number.isInteger(tab?.id)) throw new Error('Could not open ChatGPT.');
  await waitForTabComplete(tab.id);

  let bindings = { ...current.bindings };
  const profile = await getLearnerProfileTemplate();
  let created = 0;
  let reused = 0;

  for (const child of missing) {
    const request = { type: 'setup.project.ensure', name: child.name || child.id, instructions: profile.template };
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, request);
    } catch {
      await chrome.tabs.reload(tab.id);
      await waitForTabComplete(tab.id);
      result = await chrome.tabs.sendMessage(tab.id, request);
    }

    if (result?.error || !result?.projectId) {
      throw new Error(result?.error || `Could not create the ChatGPT Project for ${child.name || child.id}.`);
    }

    bindings = bindChild(bindings, child.id, result.projectId);
    if (result.reused) reused += 1;
    else created += 1;

    const latest = await getSettings();
    await save({
      bindings,
      threadUrls: canonicalThreadUrls(bindings, latest.threadUrls || {}),
    });
  }

  await reconcile();
  await report();
  const latest = await getSettings();
  await syncHealth(latest.health).catch(() => {});
  return { linked: children.length, created, reused };
}
