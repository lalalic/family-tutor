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
  if (!children.length) return { linked: 0, created: 0, reused: 0 };

  const tab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: true });
  if (!Number.isInteger(tab?.id)) throw new Error('Could not open ChatGPT.');
  await waitForTabComplete(tab.id);

  let bindings = { ...current.bindings };
  const profile = await getLearnerProfileTemplate();
  let created = 0;
  let reused = 0;

  for (const child of children) {
    const learnerName = child.name || child.id;
    const existingProjectId = bindings[child.id];
    const request = { type: 'setup.project.ensure', name: learnerName };
    let result = existingProjectId
      ? {
          projectId: existingProjectId,
          projectUrl: `https://chatgpt.com/g/${existingProjectId}/project`,
          reused: true,
        }
      : null;

    if (!result) {
      try {
        result = await chrome.tabs.sendMessage(tab.id, request);
      } catch {
        await chrome.tabs.reload(tab.id);
        await waitForTabComplete(tab.id);
        result = await chrome.tabs.sendMessage(tab.id, request);
      }
    }

    if (result?.error || !result?.projectId) {
      throw new Error(result?.error || `Could not create the ChatGPT Project for ${learnerName}.`);
    }

    if (result.projectUrl) {
      await chrome.tabs.update(tab.id, { url: result.projectUrl });
      await waitForTabComplete(tab.id);
    }

    const instructions = profile.template
      .replaceAll('<NAME>', learnerName)
      .replaceAll('<PREFERRED_NAME>', learnerName);
    const instructionsResult = await chrome.tabs.sendMessage(tab.id, {
      type: 'setup.project.instructions',
      instructions,
    });
    if (instructionsResult?.error) throw new Error(instructionsResult.error);

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
