const EXTENSION_VERSION = '2.6.9';
const MCP_URL = 'https://family-tutor.qili2.com/mcp';

function esc(value='') {
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

export function setupPlan({ children = [] } = {}) {
  const names = children.map((child) => child.name || child.id);
  return [
    { title: 'Start with Add Family Tutor', detail: 'Open the Family Tutor site and choose Add Family Tutor. Discord will ask you to sign in or create an account if needed.' },
    { title: 'Choose or create a Discord server', detail: 'Authorize Family Tutor into the family server. If you do not have a server yet, create one in Discord first, then start Add Family Tutor again.' },
    { title: 'Prepare the parent and kid channels', detail: 'Create one parent channel and one private tutor channel per kid. It is okay to claim the browser extension before these channels are ready; Family Tutor waits and rechecks instead of failing setup.' },
    { title: 'Install and claim the Family Tutor extension', detail: `Install Family Tutor extension ${EXTENSION_VERSION}, then reopen the personalized setup link. The extension claims the family automatically; no family token or Discord channel ID is copied by the user.` },
    {
      title: 'Confirm the current kids',
      detail: names.length
        ? `The current family list is: ${names.join(', ')}. If another kid is added after the extension was claimed, Setup Help refreshes the server list and that kid must be linked before setup can finish.`
        : 'The extension refreshes the family list from the server. Kids can be added after extension claim; each newly added kid must be linked before setup can finish.',
    },
    { title: 'Turn on ChatGPT Developer Mode', detail: 'Open ChatGPT Settings → Apps / advanced settings and enable Developer Mode if it is not already on.' },
    { title: 'Add Family Tutor to ChatGPT', detail: `Create the Family Tutor app/MCP connection with ${MCP_URL}. If ChatGPT asks for an auth token, use Connect ChatGPT in the extension to copy the dedicated token.` },
    { title: 'Create and link one ChatGPT Project per kid', detail: 'Create or reuse one Project named for each kid. Use the extension Setup Help / auto setup to apply the learner template and link each Project to the matching kid. Never share one learner Project between kids.' },
    { title: 'Finish setup and send welcome messages', detail: 'When Discord channels are ready, Family Tutor is connected, and every current kid is linked, finish setup. Family Tutor idempotently sends one welcome/help message to every kid channel and one to the parent channel.' },
    { title: 'Verify the real path', detail: 'Send one message in a kid channel and confirm the reply returns there. Then send one parent reminder to a named kid and confirm both child delivery and parent confirmation.' },
  ];
}

export function setupExceptions() {
  return [
    ['No Discord account', 'Use Discord sign-in/account creation, then return to Add Family Tutor.'],
    ['No Discord server', 'Create a family server first, then restart Add Family Tutor so Discord can authorize the bot into that server.'],
    ['Parent/kid channels are not ready', 'Continue through extension claim if desired. Setup remains waiting and must not create/link Projects or finish until the required channels are ready.'],
    ['A kid is added after extension claim', 'Open Setup Help or Check setup again. The extension refreshes the server child list, shows the new kid, and requires a Project link before finish.'],
    ['Discord authorization is cancelled, denied, expired, or incomplete', 'Return to /setup, fix the prerequisite, and start Add Family Tutor again. The callback always returns to the setup guide rather than a dead error page.'],
    ['Extension claim is already consumed', 'Keep using the personalized setup page for the remaining steps. Claim redemption is one-time; setup itself is resumable.'],
    ['ChatGPT requires confirmation', 'The user completes the security/authorization prompt. Manual setup and Codex setup resume from the same checklist afterward.'],
    ['A Project already exists for a kid', 'Reuse and relink it; do not create a duplicate Project.'],
    ['Setup is interrupted', 'Return to the setup page or extension Setup Help. Recheck state and continue from the first incomplete step.'],
  ];
}

export function codexSetupPrompt({ setupUrl, extensionUrl, children = [] } = {}) {
  const names = children.map((child) => child.name || child.id);
  return `Open ${setupUrl} in the user's browser and treat that page as the authoritative Family Tutor setup guide.

Complete every step you safely can. The page is also the manual for the user, so do not invent a second setup flow.

Rules:
- Use the user's existing signed-in Chrome, Discord, and ChatGPT sessions.
- Never print, persist, or expose setup claims, auth/refresh tokens, Discord provider IDs, or child conversation content.
- Stop only when Discord or ChatGPT requires an explicit human security/authorization confirmation; tell the user exactly what to confirm, then continue.
- Use the extension Setup Help for browser/ChatGPT-specific actions, but return to the server setup page for the complete checklist and exceptions.
- Re-read setup status before Project setup and before finish because channels or kids may be added after extension claim.
- Reuse an existing named kid Project instead of creating a duplicate.
- Finish only when the parent/kid Discord channels are ready and every current kid has a linked Project.
- Confirm the welcome/help message reaches every current kid channel and the parent channel.
- Finish with one real kid reply test and one parent reminder test.

Extension: ${extensionUrl}
Family Tutor MCP: ${MCP_URL}
Current kids: ${names.join(', ') || '(refresh from setup status)'}
`;
}

export function renderPublicSetupPage({ publicOrigin, error = '' } = {}) {
  const plan = setupPlan();
  const steps = plan.map((step,index) => `<li><strong>${index+1}. ${esc(step.title)}</strong><p>${esc(step.detail)}</p></li>`).join('');
  const exceptions = setupExceptions().map(([title,detail]) => `<li><strong>${esc(title)}</strong><p>${esc(detail)}</p></li>`).join('');
  const errorText = error
    ? `<section class="error"><strong>Discord setup was not completed.</strong><p>${esc(error === 'access_denied' ? 'Authorization was cancelled or denied. Fix the prerequisite below, then try Add Family Tutor again.' : 'Fix the prerequisite below, then start Add Family Tutor again.')}</p></section>`
    : '';
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up Family Tutor</title>
<style>
:root{color-scheme:light;--ink:#17211f;--muted:#68726f;--line:#e5e9e7;--brand:#14848d;--soft:#f6f8f7;--red:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff}
main{max-width:820px;margin:42px auto;padding:0 22px 60px}h1{font-size:34px;margin:0 0 6px}.muted{color:var(--muted)}
.error{border:1px solid #fecaca;background:#fff7f7;color:var(--red);border-radius:14px;padding:14px 16px;margin:20px 0}.error p{margin:4px 0 0}
.manual{margin-top:26px}.manual li{margin:0 0 16px}.manual p{margin:4px 0;color:var(--muted)}
a.button{display:inline-block;border-radius:9px;background:var(--brand);color:#fff;padding:10px 14px;text-decoration:none}
</style>
<main>
  <p class="muted">Family Tutor setup</p>
  <h1>Set up Family Tutor</h1>
  <p>This is the canonical setup guide for both people and Codex. Codex should open this page and follow it directly.</p>
  ${errorText}
  <p><a class="button" href="${esc(publicOrigin)}/discord/install">Add Family Tutor</a></p>
  <section class="manual">
    <h2>Complete setup</h2>
    <ol>${steps}</ol>
    <h2>Exceptions and recovery</h2>
    <ul>${exceptions}</ul>
  </section>
</main>`;
}

export function renderSetupPage({ claim, publicOrigin, extensionUrl = `${publicOrigin}/downloads/family-tutor-extension-${EXTENSION_VERSION}.zip`, children = [], consumed = false } = {}) {
  const setupUrl = `${publicOrigin}/setup/${encodeURIComponent(claim)}`;
  const plan = setupPlan({ children });
  const codex = codexSetupPrompt({ setupUrl, extensionUrl, children });
  const exceptions = setupExceptions().map(([title,detail]) => `<li><strong>${esc(title)}</strong><p>${esc(detail)}</p></li>`).join('');
  const kids = children.length
    ? children.map((child) => `<li>${esc(child.name || child.id)}</li>`).join('')
    : '<li>Kids will appear after Family Tutor connects.</li>';
  const steps = plan.map((step,index) => `<li><strong>${index+1}. ${esc(step.title)}</strong><p>${esc(step.detail)}</p></li>`).join('');
  const codexJson = JSON.stringify(codex).replaceAll('<','\\u003c');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up Family Tutor</title>
<style>
:root{color-scheme:light;--ink:#17211f;--muted:#68726f;--line:#e5e9e7;--brand:#14848d;--soft:#f6f8f7}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff}
main{max-width:900px;margin:42px auto;padding:0 22px 60px}h1{font-size:34px;margin:0 0 6px}.muted{color:var(--muted)}
.summary{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:22px 0}
.choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:24px 0}.choice{border:1px solid var(--line);border-radius:16px;padding:18px}
a.button,button{display:inline-block;border:0;border-radius:9px;background:var(--brand);color:#fff;padding:10px 14px;text-decoration:none;cursor:pointer;font:inherit}
a.secondary,button.secondary{background:#17211f}.manual{margin-top:28px}.manual li{margin:0 0 16px}.manual p{margin:4px 0;color:var(--muted)}
code{background:#f1f3f2;padding:2px 5px;border-radius:5px;word-break:break-all}.kids{display:flex;gap:7px;flex-wrap:wrap;padding:0;list-style:none}.kids li{background:#eef3f1;border-radius:999px;padding:5px 9px}
.notice{margin-top:10px;color:var(--muted)}.status-ok{color:#15803d}
@media(max-width:700px){.choice-grid{grid-template-columns:1fr}}
</style>
<main>
  <p class="muted">Discord connected</p>
  <h1>Set up Family Tutor</h1>
  <p>This personalized page uses the same canonical checklist as <a href="${esc(publicOrigin)}/setup">the public setup guide</a>.</p>

  <section class="summary">
    <strong>Setup code</strong>
    <p><code id="claim-code">${esc(claim)}</code></p>
    <p id="status" class="${consumed ? 'status-ok' : 'notice'}">${consumed ? 'Extension claim completed. Continue with the remaining steps below.' : 'Install the extension, then reopen or refresh this page. It will claim this family automatically.'}</p>
    <strong>Current kids</strong>
    <ul class="kids">${kids}</ul>
  </section>

  <div class="choice-grid">
    <section class="choice">
      <h2>Manual setup</h2>
      <p>Follow the checklist below from the first incomplete step.</p>
      <a class="button" href="#manual">Follow manual setup</a>
    </section>
    <section class="choice">
      <h2>Setup with Codex</h2>
      <p>Give Codex this setup URL. Codex opens this page, follows the same checklist, and pauses only for confirmations that require you.</p>
      <button id="copy-codex" class="secondary">Copy Codex setup instruction</button>
      <p id="copy-status" class="notice"></p>
    </section>
  </div>

  <section id="manual" class="manual">
    <h2>Complete setup</h2>
    <ol>${steps}</ol>
    <p><a class="button" href="${esc(extensionUrl)}">Install Family Tutor extension ${EXTENSION_VERSION}</a></p>
    <p class="muted">The extension's <strong>Setup Help</strong> handles browser/ChatGPT actions. This server page remains the source of truth for the whole setup.</p>
    <h2>Exceptions and recovery</h2>
    <ul>${exceptions}</ul>
  </section>
</main>
<script>
const codexPrompt=${codexJson};
document.getElementById('copy-codex').addEventListener('click',async()=>{
  const status=document.getElementById('copy-status');
  try{
    await navigator.clipboard.writeText(codexPrompt);
    status.textContent='Copied. Give this instruction to Codex.';
  }catch{
    status.textContent='Copy failed. Give Codex this page URL and ask it to complete Family Tutor setup.';
  }
});
</script>`;
}
