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
    { id:'prerequisites', title:'Prepare Discord first', detail:'Before Family Tutor setup, have a Discord account, one family Discord server, one parent channel, and one dedicated kid channel for every child. These are prerequisites; Family Tutor does not create them for you.' },
    { id:'discord', title:'Add Family Tutor to Discord', detail:'From the Family Tutor site choose Add Family Tutor, select the already-prepared family server, and authorize Family Tutor.' },
    { id:'extension', title:'Install the Family Tutor extension', detail:`Install the Family Tutor extension. The extension can claim a personalized setup session and provides Auto Setup plus a link back to this canonical hosted guide; it does not contain a second setup manual.` },
    {
      id:'kids',
      title:'Confirm the current kids',
      detail: names.length
        ? `The current family list is: ${names.join(', ')}. Every kid must already have a Discord channel and later gets one dedicated ChatGPT Project.`
        : 'Confirm every kid who will use Family Tutor already has a dedicated Discord channel. The claimed setup page refreshes the current family list from the server.',
    },
    { id:'developer-mode', title:'Turn on ChatGPT Developer Mode', detail:'Open ChatGPT Settings → Apps / advanced settings and enable Developer Mode if it is not already on.' },
    { id:'plugin', title:'Add Family Tutor to ChatGPT', detail:`Create/connect the Family Tutor app/MCP using ${MCP_URL}. If ChatGPT requests authentication, use the Family Tutor extension to provide the dedicated ChatGPT connection token.` },
    { id:'projects', title:'Create and link one ChatGPT Project per kid', detail:'Create or reuse one dedicated ChatGPT Project for each kid, apply the learner setup, and link it to the matching kid. Never share one learner Project between kids. The extension Auto Setup button may best-effort automate these browser/ChatGPT actions.' },
    { id:'finish', title:'Finish setup and send welcome messages', detail:'When Family Tutor is connected and every current kid is linked, finish setup. Family Tutor idempotently sends one welcome/help message to every kid channel and one to the parent channel.' },
    { id:'verify', title:'Verify the real path', detail:'Send one message in a kid channel and confirm the reply returns there. Then send one parent reminder to a named kid and confirm both child delivery and parent confirmation.' },
  ];
}

export function setupExceptions() {
  return [
    ['Discord prerequisite missing', 'Create/sign in to Discord, create the family server, then create the parent channel and every kid channel before continuing Family Tutor setup.'],
    ['Discord authorization is cancelled or denied', 'Return to /setup?step=prerequisites, confirm the Discord prerequisites, then start Add Family Tutor again.'],
    ['Extension claim is already consumed', 'Keep using the same claim-bearing setup page for remaining steps. Claim redemption is one-time; setup itself is resumable.'],
    ['ChatGPT requires confirmation', 'Complete the security/authorization prompt, then continue from the same hosted setup step.'],
    ['A Project already exists for a kid', 'Reuse and relink it; do not create a duplicate Project.'],
    ['Setup is interrupted', 'Return to this hosted setup page and continue from the first incomplete step.'],
  ];
}

function normalizeStep(step, plan) {
  const fallback = plan[0]?.id || 'prerequisites';
  return plan.some((item) => item.id === step) ? step : fallback;
}

function renderStepNav({ plan, selected, baseUrl }) {
  return plan.map((item) => {
    const href = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}step=${encodeURIComponent(item.id)}`;
    return `<a class="step-link${item.id===selected ? ' current' : ''}" href="${esc(href)}">${esc(item.title)}</a>`;
  }).join('');
}

function renderSteps({ plan, selected }) {
  return plan.map((item,index) =>
    `<li id="step-${esc(item.id)}" class="${item.id===selected ? 'current-step' : ''}"><strong>${index+1}. ${esc(item.title)}</strong><p>${esc(item.detail)}</p></li>`
  ).join('');
}

export function codexSetupPrompt({ setupUrl, extensionUrl, children = [] } = {}) {
  const names = children.map((child) => child.name || child.id);
  return `Open ${setupUrl} in the user's browser and treat that page as the single authoritative Family Tutor setup guide.

Complete every step you safely can from that page. Do not invent or use a second setup flow.

Rules:
- Discord account, family server, parent channel, and every kid channel are prerequisites. If any is missing, stop at the prerequisites step.
- Use the user's existing signed-in Chrome, Discord, and ChatGPT sessions.
- Never print, persist, or expose setup claims, auth/refresh tokens, Discord provider IDs, or child conversation content.
- Stop only when Discord or ChatGPT requires an explicit human security/authorization confirmation; tell the user exactly what to confirm, then continue.
- Follow the page's current ?step=... when present, and return to the hosted page for every next/manual step.
- The extension may provide Auto Setup for best-effort browser/ChatGPT automation, but it is not a help/manual source.
- Reuse an existing named kid Project instead of creating a duplicate.
- Finish only when every current kid has a linked Project.
- Confirm the welcome/help message reaches every current kid channel and the parent channel.
- Finish with one real kid reply test and one parent reminder test.

Extension: ${extensionUrl}
Family Tutor MCP: ${MCP_URL}
Current kids: ${names.join(', ') || '(refresh from setup status)'}
`;
}

export function renderPublicSetupPage({ publicOrigin, error = '', step = '' } = {}) {
  const plan = setupPlan();
  const selected = normalizeStep(step || (error ? 'prerequisites' : ''), plan);
  const steps = renderSteps({plan, selected});
  const nav = renderStepNav({plan, selected, baseUrl:`${publicOrigin}/setup`});
  const exceptions = setupExceptions().map(([title,detail]) => `<li><strong>${esc(title)}</strong><p>${esc(detail)}</p></li>`).join('');
  const errorText = error
    ? `<section class="error"><strong>Discord setup was not completed.</strong><p>${esc(error === 'access_denied' ? 'Authorization was cancelled or denied. Confirm the Discord prerequisites below, then try Add Family Tutor again.' : 'Confirm the Discord prerequisites below, then start Add Family Tutor again.')}</p></section>`
    : '';
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up Family Tutor</title>
<style>
:root{color-scheme:light;--ink:#17211f;--muted:#68726f;--line:#e5e9e7;--brand:#14848d;--soft:#f6f8f7;--red:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff}
main{max-width:900px;margin:42px auto;padding:0 22px 60px}h1{font-size:34px;margin:0 0 6px}.muted{color:var(--muted)}
.error{border:1px solid #fecaca;background:#fff7f7;color:var(--red);border-radius:14px;padding:14px 16px;margin:20px 0}.error p{margin:4px 0 0}
.steps-nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.step-link{border:1px solid var(--line);border-radius:999px;padding:6px 10px;text-decoration:none;color:var(--ink)}.step-link.current{border-color:var(--brand);background:#eaf7f8;color:#0b6067}
.manual{margin-top:26px}.manual li{margin:0 0 16px;padding:12px 14px;border-radius:12px}.manual p{margin:4px 0;color:var(--muted)}.current-step{background:var(--soft);outline:2px solid #d7efef}
a.button{display:inline-block;border-radius:9px;background:var(--brand);color:#fff;padding:10px 14px;text-decoration:none}
</style>
<main>
  <p class="muted">Family Tutor setup</p>
  <h1>Set up Family Tutor</h1>
  <p>This is the one canonical setup guide for people, Codex, and the Family Tutor extension. Open a specific step with <code>?step=&lt;step&gt;</code>.</p>
  ${errorText}
  <div class="steps-nav">${nav}</div>
  <p><a class="button" href="${esc(publicOrigin)}/discord/install">Add Family Tutor</a></p>
  <section class="manual">
    <h2>Complete setup</h2>
    <ol>${steps}</ol>
    <h2>Exceptions and recovery</h2>
    <ul>${exceptions}</ul>
  </section>
</main>`;
}

export function renderSetupPage({ claim, publicOrigin, extensionUrl = `${publicOrigin}/downloads/family-tutor-extension.zip`, children = [], consumed = false, step = '' } = {}) {
  const baseSetupUrl = `${publicOrigin}/setup/${encodeURIComponent(claim)}`;
  const plan = setupPlan({ children });
  const selected = normalizeStep(step || (consumed ? 'kids' : 'extension'), plan);
  const setupUrl = `${baseSetupUrl}?step=${encodeURIComponent(selected)}`;
  const codex = codexSetupPrompt({ setupUrl, extensionUrl, children });
  const nav = renderStepNav({plan, selected, baseUrl:baseSetupUrl});
  const exceptions = setupExceptions().map(([title,detail]) => `<li><strong>${esc(title)}</strong><p>${esc(detail)}</p></li>`).join('');
  const kids = children.length
    ? children.map((child) => `<li>${esc(child.name || child.id)}</li>`).join('')
    : '<li>Kids will appear after Family Tutor connects.</li>';
  const steps = renderSteps({plan, selected});
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
.steps-nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.step-link{border:1px solid var(--line);border-radius:999px;padding:6px 10px;text-decoration:none;color:var(--ink)}.step-link.current{border-color:var(--brand);background:#eaf7f8;color:#0b6067}
.choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:24px 0}.choice{border:1px solid var(--line);border-radius:16px;padding:18px}
a.button,button{display:inline-block;border:0;border-radius:9px;background:var(--brand);color:#fff;padding:10px 14px;text-decoration:none;cursor:pointer;font:inherit}
a.secondary,button.secondary{background:#17211f}.manual{margin-top:28px}.manual li{margin:0 0 16px;padding:12px 14px;border-radius:12px}.manual p{margin:4px 0;color:var(--muted)}.current-step{background:var(--soft);outline:2px solid #d7efef}
code{background:#f1f3f2;padding:2px 5px;border-radius:5px;word-break:break-all}.kids{display:flex;gap:7px;flex-wrap:wrap;padding:0;list-style:none}.kids li{background:#eef3f1;border-radius:999px;padding:5px 9px}
.notice{margin-top:10px;color:var(--muted)}.status-ok{color:#15803d}
@media(max-width:700px){.choice-grid{grid-template-columns:1fr}}
</style>
<main>
  <p class="muted">Family Tutor setup</p>
  <h1>Set up Family Tutor</h1>
  <p>This claim page is the same canonical setup guide used by people and Codex. The selected step is <code>?step=${esc(selected)}</code>.</p>
  <div class="steps-nav">${nav}</div>

  <section class="summary">
    <strong>Setup session</strong>
    <p id="status" class="${consumed ? 'status-ok' : 'notice'}">${consumed ? 'Extension claim completed. Continue with the remaining steps below.' : 'Install the extension, then reopen or refresh this page. It will claim this family automatically.'}</p>
    <strong>Current kids</strong>
    <ul class="kids">${kids}</ul>
  </section>

  <div class="choice-grid">
    <section class="choice">
      <h2>Manual setup</h2>
      <p>Follow this hosted checklist from the selected or first incomplete step.</p>
      <a class="button" href="#manual">Follow manual setup</a>
    </section>
    <section class="choice">
      <h2>Setup with Codex</h2>
      <p>Give Codex this setup URL. Codex opens this exact guide, follows it directly, and pauses only for protected confirmations.</p>
      <button id="copy-codex" class="secondary">Copy Codex setup instruction</button>
      <p id="copy-status" class="notice"></p>
    </section>
  </div>

  <section id="manual" class="manual">
    <h2>Complete setup</h2>
    <ol>${steps}</ol>
    <p><a class="button" href="${esc(extensionUrl)}">Install Family Tutor extension</a></p>
    <p class="muted">The extension may offer <strong>Auto Setup</strong> to try the automatable steps. For instructions or recovery, open this hosted setup guide; the extension does not carry a second help manual.</p>
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
