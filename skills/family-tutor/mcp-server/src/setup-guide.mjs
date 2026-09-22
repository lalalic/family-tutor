const MCP_URL = 'https://family-tutor.qili2.com/mcp';

function esc(value='') {
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function channelTree(names=[]) {
  const kids = names.length ? names : ['Sammy','Meggie'];
  return [
    '<div class="channel-tree">',
    '<div class="server">⌄ &lt;your family Discord server&gt;</div>',
    '<div class="channel"># parents <span>text channel</span></div>',
    ...kids.map((name)=>`<div class="channel"># ${esc(name)} <span>text channel</span></div>`),
    '<div class="channel"># … <span>one text channel per kid</span></div>',
    '</div>',
  ].join('');
}

export function setupPlan({ children = [], publicOrigin = 'https://family-tutor.qili2.com', extensionUrl = '' } = {}) {
  const names = children.map((child) => child.name || child.id);
  const installUrl = extensionUrl || `${publicOrigin}/downloads/family-tutor-extension.zip`;
  const storeInstall = installUrl.includes('chromewebstore.google.com') || installUrl.includes('chrome.google.com/webstore');
  return [
    {
      id:'prerequisites',
      title:'Prepare your Discord family server',
      detail:'Family Tutor needs an existing Discord account, family server, one parents text channel, and one text channel for each kid before setup can continue.',
      substeps:[
        { title:'Create or sign in to Discord', body:'Use the Discord account that will manage the family server.' },
        { title:'Create the family server', body:'Create one Discord server for the family if you do not already have one.' },
        { title:'Create text channels', html:channelTree(names) },
      ],
    },
    {
      id:'extension',
      title:'Install the Family Tutor Chrome extension',
      detail:'Install the browser bridge before authorizing Discord so the personalized claim page can connect the family immediately.',
      substeps:[
        ...(storeInstall ? [{
          title:'Install from Chrome Web Store',
          html:`<p>Open the official listing and choose <strong>Add to Chrome</strong>.</p><p><a class="button secondary" href="${esc(installUrl)}" target="_blank" rel="noreferrer">Open Chrome Web Store</a></p>`,
        }] : [{
          title:'Download the packed extension',
          html:`<p>Download the current Family Tutor ZIP.</p><p><a class="button secondary" href="${esc(installUrl)}">Download extension ZIP</a></p>`,
        },{
          title:'Unpack the ZIP',
          body:'Open the downloaded ZIP and extract it to a permanent folder. Do not load the ZIP file itself in Chrome.',
        },{
          title:'Open Chrome Extensions',
          html:'<p>Open <code>chrome://extensions</code> in Chrome.</p>',
        },{
          title:'Enable Developer mode',
          body:'Turn on Developer mode in the top-right corner of the Chrome Extensions page.',
        },{
          title:'Load unpacked',
          body:'Choose Load unpacked, select the extracted Family Tutor extension folder, and confirm the extension appears in Chrome.',
        }]),
        { title:'Pin Family Tutor', body:'Open Chrome’s Extensions menu and pin Family Tutor so its menu is easy to reach during setup.' },
      ],
    },
    {
      id:'discord',
      title:'Add Family Tutor to Discord',
      detail:'Authorize Neo / Family Tutor into the already-prepared family server once, then grant it access to the parents and kid text channels.',
      substeps:[
        { title:'Start authorization', html:`<p><a class="button" href="${esc(publicOrigin)}/discord/install">Add Family Tutor</a></p>` },
        { title:'Choose the family server', body:'In Discord, select the server that contains the parents channel and all kid channels.' },
        { title:'Authorize Neo to the server', body:'Approve the requested Discord permissions. This adds the Neo / Family Tutor bot to the selected Discord server once. After authorization, Discord returns you to the personalized Family Tutor setup page.' },
        { title:'Grant Neo access to each Family Tutor channel', body:'For #parents and every kid text channel, open Edit Channel → Permissions, add the Neo / Family Tutor bot or its server role, and allow View Channel, Send Messages, and Read Message History. Also allow any attachment/reaction permissions Family Tutor needs. You do not run the bot invite again for each channel.' },
      ],
    },
    {
      id:'kids',
      title:'Confirm your family in the extension',
      detail: names.length
        ? `Open the Family Tutor extension menu and confirm these kids appear: ${names.join(', ')}.`
        : 'Open the Family Tutor extension menu and confirm every kid appears before continuing.',
      substeps:[
        { title:'Open the extension menu', body:'Click the pinned Family Tutor extension icon in Chrome.' },
        { title:'Check connection', body:'Confirm the extension shows Connected. If it does not, reopen the personalized setup page or use Reconnect.' },
        { title:'Check kids', body:names.length ? `Confirm the menu lists ${names.join(', ')}. Each kid will be linked to a separate ChatGPT Project later.` : 'Confirm the menu lists every kid who has a Discord channel.' },
      ],
    },
    {
      id:'developer-mode',
      group:'Set up ChatGPT',
      title:'Turn on ChatGPT Developer Mode',
      detail:'Developer Mode allows ChatGPT to add the Family Tutor MCP app. The extension Auto Setup button can try this and the remaining ChatGPT steps for you.',
      substeps:[
        { title:'Try Auto Setup first', body:'Open the Family Tutor extension and choose Auto Setup. It will try the browser/ChatGPT steps it can safely automate. Continue manually below for anything it cannot finish.' },
        { title:'Open ChatGPT settings', body:'In ChatGPT, open Settings, then Apps / advanced settings.' },
        { title:'Enable Developer Mode', body:'Turn on Developer Mode and accept any ChatGPT confirmation.' },
      ],
    },
    {
      id:'plugin',
      group:'Set up ChatGPT',
      title:'Connect the Family Tutor MCP app',
      detail:'Add one Family Tutor MCP connection in ChatGPT using the exact values below.',
      substeps:[
        { title:'Open the app/MCP creation screen', body:'In ChatGPT Developer Mode, choose the option to create or add a custom app / MCP server.' },
        { title:'Enter these values', html:`<div class="fields">
          <div><span>Name</span><code>Family Tutor</code></div>
          <div><span>MCP server URL</span><code>${esc(MCP_URL)}</code></div>
          <div><span>Authentication</span><code>OAuth</code></div>
        </div>
        <p>If this ChatGPT surface asks for a bearer/auth token instead of OAuth, open the Family Tutor extension, choose <strong>Connect ChatGPT</strong>, then paste the copied token into ChatGPT’s authentication field.</p>` },
        { title:'Save and connect', body:'Save the app/MCP connection and complete any ChatGPT authorization prompt. Family Tutor should then appear as a connected app/tool.' },
      ],
    },
    {
      id:'projects',
      group:'Set up ChatGPT',
      title:'Create and link one ChatGPT Project per kid',
      detail:'Each kid needs a dedicated Project and at least one conversation thread inside that Project. The extension links the current Project/thread to the selected kid.',
      substeps:[
        { title:'Create or open the kid Project', body:'Create one ChatGPT Project named for the kid, for example Sammy. Reuse an existing dedicated kid Project if it already exists.' },
        { title:'Create or open a thread inside the Project', body:'Open a conversation inside that Project. A Project landing page without a conversation thread is not enough for linking.' },
        { title:'Open the Family Tutor extension', body:'While that Project conversation is the active Chrome tab, open the Family Tutor extension menu.' },
        { title:'Link the kid', body:'Find the matching kid and click the link icon. The extension links the current ChatGPT Project/thread to that kid. A check mark indicates the active Project is linked.' },
        { title:'Repeat for every kid', body:'Open a separate Project thread for the next kid and repeat. Never link two kids to the same learner Project.' },
      ],
    },
    {
      id:'finish',
      title:'Finish setup',
      detail:'Complete setup only after Family Tutor is connected and every kid has a linked ChatGPT Project.',
      substeps:[
        { title:'Check all links', body:'In the extension menu, confirm every kid has a linked Project and the extension is Connected.' },
        { title:'Finish', body:'Complete setup. Family Tutor sends one idempotent welcome/help message to every kid channel and one to the parents channel.' },
      ],
    },
    {
      id:'verify',
      title:'Verify the family path',
      detail:'Run one kid test and one parent reminder test to verify routing before relying on the setup.',
      substeps:[
        { title:'Kid test', body:'Send a short message in one kid Discord channel and confirm Neo replies in that same channel.' },
        { title:'Parent test', body:'From the parents channel, send a reminder to a named kid and confirm it reaches that kid and the parents channel receives confirmation.' },
      ],
    },
  ];
}

export function setupExceptions() {
  return [
    ['Discord prerequisite missing', 'Create/sign in to Discord, create the family server, then create the parents text channel and every kid text channel before continuing.'],
    ['Discord authorization is cancelled or denied', 'Return to the setup page, confirm the Discord prerequisites, then start Add Family Tutor again.'],
    ['Extension claim is already consumed', 'Keep using the same claim-bearing setup page for remaining steps. Claim redemption is one-time; setup itself is resumable.'],
    ['ChatGPT requires confirmation', 'Complete the security/authorization prompt, then continue from the same hosted setup step.'],
    ['A Project already exists for a kid', 'Reuse it, open or create a thread inside it, then relink it; do not create a duplicate Project.'],
    ['Setup is interrupted', 'Return to this hosted setup page and continue from the first incomplete step.'],
  ];
}

function normalizeStep(step, plan) {
  const fallback = plan[0]?.id || 'prerequisites';
  return plan.some((item) => item.id === step) ? step : fallback;
}

function renderStepNav({ plan, selected, baseUrl }) {
  return plan.map((item,index) => {
    const href = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}step=${encodeURIComponent(item.id)}`;
    return `<a class="step-link${item.id===selected ? ' current' : ''}" href="${esc(href)}"><span>${index+1}</span>${esc(item.title)}</a>`;
  }).join('');
}

function renderSubsteps(item) {
  const substeps = item.substeps || [];
  if(!substeps.length) return '';
  const rows = substeps.map((sub,index)=>`<li><strong>${index+1}. ${esc(sub.title)}</strong>${sub.html || `<p>${esc(sub.body||'')}</p>`}</li>`).join('');
  return `<details class="substeps"><summary>Detailed steps</summary><ol>${rows}</ol></details>`;
}

function renderSteps({ plan, selected }) {
  let lastGroup = '';
  return plan.map((item,index) => {
    const group = item.group && item.group !== lastGroup ? `<li class="group-title">${esc(item.group)}<span>The extension’s <strong>Auto Setup</strong> can try these ChatGPT steps first.</span></li>` : '';
    if(item.group) lastGroup = item.group;
    return `${group}<li id="step-${esc(item.id)}" class="step-card${item.id===selected ? ' current-step' : ''}">
      <div class="step-head"><span class="step-number">${index+1}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></div>
      ${renderSubsteps(item)}
    </li>`;
  }).join('');
}

export function codexSetupPrompt({ setupUrl, extensionUrl, children = [] } = {}) {
  const names = children.map((child) => child.name || child.id);
  return `Open ${setupUrl} in the user's browser and treat that page as the single authoritative Family Tutor setup guide.

Complete every step you safely can from that page. Expand each step's Detailed steps section and follow it exactly. Do not invent or use a second setup flow.

Rules:
- Discord account, family server, parents text channel, and every kid text channel are prerequisites. Neo is authorized to the server afterward, then granted access to those channels through Discord permissions.
- Use the user's existing signed-in Chrome, Discord, and ChatGPT sessions.
- Never print, persist, or expose setup claims, auth/refresh tokens, Discord provider IDs, or child conversation content.
- Stop only when Discord or ChatGPT requires an explicit human security/authorization confirmation.
- The extension's Auto Setup may be tried first for the ChatGPT group, then continue manually from the hosted guide.
- Each kid needs a dedicated ChatGPT Project and an active thread inside that Project before linking.
- Reuse an existing named kid Project instead of creating a duplicate.
- Finish only when every current kid has a linked Project.
- Finish with one real kid reply test and one parent reminder test.

Extension: ${extensionUrl}
Family Tutor MCP: ${MCP_URL}
Current kids: ${names.join(', ') || '(confirm in the extension menu)'}
`;
}

function pageStyles(){
  return `
:root{color-scheme:light;--ink:#17211f;--muted:#68726f;--line:#e5e9e7;--brand:#14848d;--soft:#f6f8f7;--red:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff}
main{max-width:920px;margin:42px auto;padding:0 22px 60px}h1{font-size:34px;margin:0 0 12px}.muted{color:var(--muted)}
.error{border:1px solid #fecaca;background:#fff7f7;color:var(--red);border-radius:14px;padding:14px 16px;margin:18px 0}.error p{margin:4px 0 0}
.steps-nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}.step-link{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:6px 10px;text-decoration:none;color:var(--ink)}.step-link span{font-weight:700}.step-link.current{border-color:var(--brand);background:#eaf7f8;color:#0b6067}
.manual{margin-top:26px}.manual>ol{list-style:none;padding:0;margin:0}.step-card{margin:0 0 14px;padding:16px;border:1px solid var(--line);border-radius:14px}.step-head{display:flex;gap:12px;align-items:flex-start}.step-head strong{font-size:16px}.step-head p{margin:4px 0;color:var(--muted)}.step-number{flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--soft);font-weight:750}.current-step{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.substeps{margin:12px 0 0 40px;border-top:1px solid var(--line);padding-top:10px}.substeps summary{cursor:pointer;font-weight:650;color:var(--brand)}.substeps ol{margin:10px 0 0;padding-left:22px}.substeps li{margin:0 0 13px}.substeps p{margin:4px 0;color:var(--muted)}
.group-title{list-style:none;margin:28px 0 12px;font-size:20px;font-weight:750}.group-title span{display:block;font-size:13px;font-weight:400;color:var(--muted);margin-top:2px}
.channel-tree{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);border-radius:10px;padding:12px 14px;margin-top:7px}.channel-tree .server{font-weight:750}.channel-tree .channel{padding-left:22px;margin-top:6px}.channel-tree .channel span{color:var(--muted);font-family:system-ui,-apple-system,sans-serif;font-size:12px}
.fields{display:grid;gap:8px;margin:8px 0 10px}.fields div{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px;align-items:center}.fields span{color:var(--muted)}code{background:#f1f3f2;padding:3px 6px;border-radius:5px;word-break:break-all}
a.button,button{display:inline-block;border:0;border-radius:9px;background:var(--brand);color:#fff;padding:10px 14px;text-decoration:none;cursor:pointer;font:inherit}a.secondary,button.secondary{background:#17211f}
.summary{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:22px 0}.choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:24px 0}.choice{border:1px solid var(--line);border-radius:16px;padding:18px}.kids{display:flex;gap:7px;flex-wrap:wrap;padding:0;list-style:none}.kids li{background:#eef3f1;border-radius:999px;padding:5px 9px}.notice{margin-top:10px;color:var(--muted)}.status-ok{color:#15803d}
@media(max-width:700px){.choice-grid{grid-template-columns:1fr}.fields div{grid-template-columns:1fr}.substeps{margin-left:0}}
`;
}

export function renderPublicSetupPage({ publicOrigin, error = '', step = '', extensionUrl = '' } = {}) {
  const installUrl = extensionUrl || `${publicOrigin}/downloads/family-tutor-extension.zip`;
  const plan = setupPlan({publicOrigin,extensionUrl:installUrl});
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
<style>${pageStyles()}</style>
<main>
  <p class="muted">Family Tutor setup</p>
  <h1>Set up Family Tutor</h1>
  <p><a class="button" href="${esc(publicOrigin)}/discord/install">Add Family Tutor</a></p>
  ${errorText}
  <div class="steps-nav">${nav}</div>
  <section class="manual">
    <ol>${steps}</ol>
    <h2>Exceptions and recovery</h2>
    <ul>${exceptions}</ul>
  </section>
</main>`;
}

export function renderSetupPage({ claim, publicOrigin, extensionUrl = `${publicOrigin}/downloads/family-tutor-extension.zip`, children = [], consumed = false, step = '' } = {}) {
  const baseSetupUrl = `${publicOrigin}/setup/${encodeURIComponent(claim)}`;
  const plan = setupPlan({ children, publicOrigin, extensionUrl });
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
<style>${pageStyles()}</style>
<main>
  <p class="muted">Family Tutor setup</p>
  <h1>Set up Family Tutor</h1>
  <p><a class="button" href="${esc(publicOrigin)}/discord/install">Add Family Tutor</a></p>
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
      <p>Follow the checklist below. Expand Detailed steps under each item for exact actions.</p>
      <a class="button" href="#manual">Manual setup</a>
    </section>
    <section class="choice">
      <h2>Setup with Codex</h2>
      <p>Codex opens this exact guide and follows the same detailed steps.</p>
      <button id="copy-codex" class="secondary">Copy Codex setup instruction</button>
      <p id="copy-status" class="notice"></p>
    </section>
  </div>

  <section id="manual" class="manual">
    <ol>${steps}</ol>
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
