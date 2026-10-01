import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

test('setup page is wired to automatic family claim',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.version,'2.6.23');
  const setup=manifest.content_scripts.find(script=>script.matches?.includes('https://family-tutor.qili2.com/setup/*'));
  assert.deepEqual(setup?.js,['setup.js']);
  const source=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.match(source,/family\.setup\.claim/);
  assert.match(source,/^\(\(\) =>/);
});

test('content script supports the current ChatGPT ProseMirror composer and submitted-turn marker',()=>{
  const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
  assert.match(content,/\[contenteditable="true"\]\[data-composer-markdown\]/);
  assert.match(content,/button\[aria-label="Edit message"\]/);
  assert.match(content,/data-user-message-bubble/);
  assert.match(content,/async function fillLiveComposer/);
  assert.match(content,/async function waitForEnabledSend/);
  assert.doesNotMatch(content,/form\.requestSubmit/);
  assert.match(content,/submitTurn\(message\)\.then\(\(\) => respond/);
  assert.match(content,/const previousTurnCount = userTurnCount\(\)/);
  assert.match(content,/const previousUserTurnCount = userTurns\(\)\.length/);
  assert.match(content,/turns\.slice\(previousUserTurnCount\)/);
  assert.match(content,/userTurnCount\(\) > previousTurnCount/);
  assert.match(content,/clearedPolls >= 2/);
  assert.match(content,/function promptTextMatches/);
  assert.match(content,/field instanceof HTMLTextAreaElement\) return normalized\(field\.value\)/);
  assert.doesNotMatch(content,/if \(isGenerating\(\)\) return \{ text: wanted/);
  assert.match(content,/!inserted \|\| !composerText\(field\)\.includes\(normalized\(text\)\)/);
});

test('turn delivery prefers structured thread identity and keeps existing threads warm',()=>{
  const source=fs.readFileSync(path.join(root,'background.js'),'utf8');
  const direct=source.indexOf('const direct = await deliverToExistingProjectTab(turn, projectId, savedThreadUrl, savedThreadId);');
  const reconcile=source.indexOf('await reconcileFamilyTabs({}, { allowCreate: false });',direct);
  assert.ok(direct>=0);
  assert.ok(reconcile>direct);
  assert.match(source,/threadIdFromChatGptUrl/);
  assert.match(source,/findThreadTab\(projectId, current\.threadIds\[turn\.childId\]\)/);
  assert.match(source,/stale_thread_recovery/);
  assert.match(source,/recoverChildProjectRoot/);
  assert.match(source,/delete threadUrls\[childId\]/);
  assert.match(source,/delete threadIds\[childId\]/);
  assert.match(source,/projectRootUrl\(projectId\)/);
  assert.match(source,/stale Family Tutor content script/);
  assert.match(source,/deliverWarmTurn/);
  const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
  assert.match(content,/submitTurn\(message\)\.then\(\(\) => respond/);
  assert.match(content,/watchResponseComplete/);
  assert.match(content,/TURN_COMPOSER_WAIT_MS = 30000/);
  assert.match(content,/waitFor\(composer, 'ChatGPT composer', TURN_COMPOSER_WAIT_MS\)/);
  assert.match(content,/semanticAssistantTurns/);
  assert.match(content,/ChatGPT said:/);
  assert.match(content,/turn\.response_complete/);
  assert.match(content,/turn\.delivery\.required/);
  assert.match(source,/pendingFinals/);
  assert.match(source,/replayPendingFinals/);
  assert.match(source,/turn\.response_complete\.ack/);
});

test('background redeems claim without exposing a family or guild identifier to the page',()=>{
  const source=fs.readFileSync(path.join(root,'background.js'),'utf8');
  assert.match(source,/\/v1\/setup\/claim/);
  assert.match(source,/bridgeRefreshToken: result\.refresh_token/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'setup.js'),'utf8'),/guildId|familyId|access_token|refresh_token/);
});

test('rotated hosted refresh token is persisted and auth retry is scheduled',()=>{
  const source=fs.readFileSync(path.join(root,'background.js'),'utf8');
  assert.match(source,/bridgeRefreshToken: refreshed\.refreshToken/);
  assert.match(source,/scheduleReconnect\(\);[\s\S]*return;/);
});

test('popup can copy a dedicated ChatGPT auth token without exposing extension credentials',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.ok(manifest.permissions.includes('clipboardWrite'));
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  const popup=fs.readFileSync(path.join(root,'popup.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
  assert.match(background,/\/v1\/chatgpt-auth-token/);
  assert.match(background,/chatgpt\.authToken/);
  assert.match(popup,/navigator\.clipboard\.writeText\(result\.authToken\)/);
  assert.match(html,/Connect ChatGPT/);
  assert.doesNotMatch(popup,/bridgeToken|bridgeRefreshToken/);
});

test('thread rollover clears the active thread and binds the next durable conversation',()=>{
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
  assert.match(background,/async function rotateActiveThread\(childId\)/);
  assert.match(background,/projectRootUrl\(projectId\)/);
  assert.match(background,/delete nextThreadUrls\[childId\]/);
  assert.match(background,/delete nextThreadIds\[childId\]/);
  assert.match(background,/chrome\.storage\.local\.set\(\{ threadUrls: nextThreadUrls, threadIds: nextThreadIds \}\)/);
  assert.match(background,/type: 'thread\.rotated'/);
  assert.match(content,/type: 'turn\.ack'/);
  assert.match(content,/threadUrl: location\.href/);
});

test('popup refreshes Discord kids, links to hosted setup, and exposes auto setup',()=>{
  const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
  const popupJs=fs.readFileSync(path.join(root,'popup.js'),'utf8');
  assert.match(popup,/id="refresh-kids"/);
  assert.match(popup,/id="home-link"[\s\S]*Family Tutor/);
  assert.match(popup,/id="guide-link"[\s\S]*Guide/);
  assert.match(popup,/Try auto setup/);
  assert.doesNotMatch(popup,/Add kid/);
  assert.match(popupJs,/type: 'setup\.status'/);
  assert.match(popupJs,/https:\/\/family-tutor\.qili2\.com\//);
  assert.match(popupJs,/https:\/\/family-tutor\.qili2\.com\/setup/);
  assert.match(popupJs,/type: 'setup\.projects'/);
  assert.match(popupJs,/type: 'setup\.openDeveloperMode'/);
  assert.equal(fs.existsSync(path.join(root,'setup-help.html')),false);
  assert.equal(fs.existsSync(path.join(root,'setup-help.js')),false);
});


test('popup keeps refresh on the Kids row without a kid count, and zero kids clears the action badge',()=>{
  const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
  const popupJs=fs.readFileSync(path.join(root,'popup.js'),'utf8');
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  assert.match(popup,/section-head[\s\S]*<strong>Kids<\/strong>[\s\S]*id="refresh-kids"/);
  assert.doesNotMatch(popup,/kid-count/);
  assert.doesNotMatch(popupJs,/kidCount/);
  assert.match(background,/kidCount === 0 \? ''/);
});

test('auto setup applies a learner-specific profile to every kid project',()=>{
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  const automation=fs.readFileSync(path.join(root,'setup-automation.mjs'),'utf8');
  const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
  assert.match(background,/v1\/learner-profile-template/);
  assert.match(background,/getLearnerProfileTemplate/);
  assert.match(automation,/for \(const child of children\)/);
  assert.match(automation,/existingProjectId/);
  assert.match(automation,/setup\.project\.ensure/);
  assert.match(automation,/replaceAll\('<NAME>', learnerName\)/);
  assert.match(automation,/replaceAll\('<PREFERRED_NAME>', learnerName\)/);
  assert.match(automation,/setup\.project\.instructions/);
  assert.match(content,/async function ensureProject\(projectName\)/);
  assert.match(content,/Open ChatGPT and create a Project named/);
  assert.match(content,/applyProjectInstructions/);
});

test('canonical bootstrap declares Family Tutor delivery and rollover tools',()=>{
  const bootstrap=fs.readFileSync(path.resolve(root,'../bootstrap/latest.md'),'utf8');
  const profile=fs.readFileSync(path.resolve(root,'../setup/learner-profile-template.md'),'utf8');
  assert.match(bootstrap,/dedicated tutor/i);
  assert.match(bootstrap,/Project-only|Keep learners separate|Keep learners separate/i);
  assert.doesNotMatch(bootstrap,/https?:\/\//);
  assert.match(bootstrap,/reply_to_discord/);
  assert.match(bootstrap,/new_thread/);
  assert.match(bootstrap,/visible ChatGPT response is \*\*not delivery\*\*/i);
  assert.doesNotMatch(bootstrap,/FAMILY_TUTOR_DELIVERY_REMINDER/);
  assert.match(profile,/<NAME>/);
  assert.match(profile,/exactly one learner/i);
  assert.doesNotMatch(profile,/https?:\/\//);
});

test('setup status is the Discord source for available children',()=>{
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  assert.match(background,/\/v1\/setup\/status/);
  assert.match(background,/availableChildren = result\.children/);
  assert.match(background,/\/v1\/setup\/finish/);
});
