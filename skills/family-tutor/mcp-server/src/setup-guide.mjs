const EXTENSION_VERSION = '2.6.7';
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
    {
      title: 'Install the Family Tutor extension',
      detail: `Download Family Tutor extension ${EXTENSION_VERSION}, unzip it, then load it in Chrome. Reopen this setup page so the extension can claim this family automatically.`,
    },
    {
      title: 'Confirm your kids',
      detail: names.length
        ? `Family Tutor should list: ${names.join(', ')}.`
        : 'Family Tutor should list the kids configured for this family.',
    },
    {
      title: 'Turn on ChatGPT Developer Mode',
      detail: 'Open ChatGPT Settings → Apps / advanced settings and enable Developer Mode if it is not already on.',
    },
    {
      title: 'Add Family Tutor to ChatGPT',
      detail: `Create the Family Tutor app/MCP connection with ${MCP_URL}. If ChatGPT asks for an auth token, use Connect ChatGPT in the extension to copy the dedicated token.`,
    },
    {
      title: 'Create and link one ChatGPT Project per kid',
      detail: 'Create or reuse one Project named for each kid. Use the extension Setup Help / auto setup to link each Project to the matching kid.',
    },
    {
      title: 'Verify the family path',
      detail: 'Confirm Family Tutor shows Connected and every kid is linked. Finish setup sends a welcome/help message to every kid channel and the parent channel; then send one kid message and one parent reminder.',
    },
  ];
}

export function codexSetupPrompt({ setupUrl, claim, extensionUrl, children = [] } = {}) {
  const names = children.map((child) => child.name || child.id);
  const numbered = setupPlan({ children }).map((step,index) => `${index+1}. ${step.title}: ${step.detail}`).join('\n');
  return `Set up Family Tutor on this computer using the exact manual below.

Setup URL: ${setupUrl}
One-time setup code: ${claim}
Extension: ${extensionUrl}
Family Tutor MCP: ${MCP_URL}
Kids: ${names.join(', ') || '(discover from Family Tutor)'}

Rules:
- Complete every step you safely can.
- Use the user's existing signed-in Chrome and ChatGPT account.
- Do not print, persist, or expose the setup code, auth token, refresh token, Discord provider IDs, or child conversation content.
- When Discord or ChatGPT requires a human security/authorization confirmation, stop at that exact screen and tell the user what to click; continue after they confirm.
- Prefer the Family Tutor extension's Setup Help / Try auto setup where available.
- Verify each completed step instead of assuming success.
- Do not create duplicate ChatGPT Projects if the named kid Project already exists.
- Finish setup only after Discord parent/kid channels and all ChatGPT Project bindings are ready. Confirm the welcome/help messages appear in every kid channel and the parent channel.
- Finish by testing one child Discord reply, one parent reminder, and a new-thread rollover.

Manual:
${numbered}
`;
}

export function renderPublicSetupPage({ publicOrigin, error = '' } = {}) {
  const plan = setupPlan();
  const steps = plan.map((step,index) => `<li><strong>${index+1}. ${esc(step.title)}</strong><p>${esc(step.detail)}</p></li>`).join('');
  const errorText = error
    ? `<section class="error"><strong>Discord setup was not completed.</strong><p>${esc(error === 'access_denied' ? 'Authorization was cancelled or denied. You can try Add Family Tutor again when ready.' : 'Return to the Discord step and try again.')}</p></section>`
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
  <p>Follow the full setup path below. You can return to this page at any time.</p>
  ${errorText}
  <p><a class="button" href="${esc(publicOrigin)}/discord/install">Add Family Tutor to Discord</a></p>
  <section class="manual">
    <h2>Setup guide</h2>
    <ol>${steps}</ol>
  </section>
</main>`;
}

export function renderSetupPage({ claim, publicOrigin, extensionUrl = `${publicOrigin}/downloads/family-tutor-extension-${EXTENSION_VERSION}.zip`, children = [], consumed = false } = {}) {
  const setupUrl = `${publicOrigin}/setup/${encodeURIComponent(claim)}`;
  const plan = setupPlan({ children });
  const codex = codexSetupPrompt({ setupUrl, claim, extensionUrl, children });
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
  <p>Choose how you want to finish setup. Both paths use the same checklist.</p>

  <section class="summary">
    <strong>Setup code</strong>
    <p><code id="claim-code">${esc(claim)}</code></p>
    <p id="status" class="${consumed ? 'status-ok' : 'notice'}">${consumed ? 'Extension claim completed. Continue with ChatGPT setup below.' : 'Install the extension, then reopen or refresh this page. It will claim this family automatically.'}</p>
    <strong>Kids</strong>
    <ul class="kids">${kids}</ul>
  </section>

  <div class="choice-grid">
    <section class="choice">
      <h2>Manual setup</h2>
      <p>Follow the checklist below. Each step has one clear action.</p>
      <a class="button" href="#manual">Follow manual setup</a>
    </section>
    <section class="choice">
      <h2>Setup with Codex</h2>
      <p>Give Codex the same manual. It can complete the automatable steps and pause only for required confirmations.</p>
      <button id="copy-codex" class="secondary">Copy setup instructions for Codex</button>
      <p id="copy-status" class="notice"></p>
    </section>
  </div>

  <section id="manual" class="manual">
    <h2>Manual setup</h2>
    <ol>${steps}</ol>
    <p><a class="button" href="${esc(extensionUrl)}">Install Family Tutor extension ${EXTENSION_VERSION}</a></p>
    <p class="muted">After installing the extension, reopen this exact setup page. Then use the extension's <strong>Setup Help</strong> page for ChatGPT Developer Mode, MCP installation, Projects, linking, and verification.</p>
  </section>
</main>
<script>
const codexPrompt=${codexJson};
document.getElementById('copy-codex').addEventListener('click',async()=>{
  const status=document.getElementById('copy-status');
  try{
    await navigator.clipboard.writeText(codexPrompt);
    status.textContent='Copied. Open Codex and paste these instructions.';
  }catch{
    status.textContent='Copy failed. Select the setup code and use the manual checklist below.';
  }
});
</script>`;
}
