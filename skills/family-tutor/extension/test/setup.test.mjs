import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

test('setup page is wired to automatic family claim',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.version,'2.6.6');
  const setup=manifest.content_scripts.find(script=>script.matches?.includes('https://family-tutor.qili2.com/setup/*'));
  assert.deepEqual(setup?.js,['setup.js']);
  const source=fs.readFileSync(path.join(root,'setup.js'),'utf8');
  assert.match(source,/family\.setup\.claim/);
  assert.match(source,/^\(\(\) =>/);
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
  assert.match(background,/chrome\.tabs\.update\(tab\.id, \{ url: `https:\/\/chatgpt\.com\/g\/\$\{projectId\}\/project` \}\)/);
  assert.match(background,/delete nextThreadUrls\[childId\]/);
  assert.match(background,/chrome\.storage\.local\.set\(\{ threadUrls: nextThreadUrls \}\)/);
  assert.match(background,/type: 'thread\.rotated'/);
  assert.match(content,/type: 'turn\.ack'/);
  assert.match(content,/threadUrl: location\.href/);
});


test('popup exposes Setup Help and the help page keeps auto setup optional',()=>{
  const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
  const popupJs=fs.readFileSync(path.join(root,'popup.js'),'utf8');
  const help=fs.readFileSync(path.join(root,'setup-help.html'),'utf8');
  const helpJs=fs.readFileSync(path.join(root,'setup-help.js'),'utf8');
  assert.match(popup,/Setup Help/);
  assert.match(popupJs,/setup-help\.html/);
  assert.match(help,/Optional: try auto setup/);
  assert.match(help,/ChatGPT Developer Mode/);
  assert.match(help,/Add Family Tutor to ChatGPT/);
  assert.match(help,/Create one ChatGPT Project for each kid/);
  assert.match(help,/Check that everything is connected/);
  assert.match(help,/Send a test message/);
  assert.match(helpJs,/type:'setup\.projects'/);
  assert.match(helpJs,/type:'setup\.openDeveloperMode'/);
  assert.match(helpJs,/type:'chatgpt\.authToken'/);
});

test('best-effort setup automation creates only missing kid projects and preserves manual fallback',()=>{
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  const automation=fs.readFileSync(path.join(root,'setup-automation.mjs'),'utf8');
  const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
  assert.match(background,/setupKidProjects/);
  assert.match(background,/message\?\.type === 'setup\.projects'/);
  assert.match(automation,/children\.filter\(\(child\) => !current\.bindings\?\.\[child\.id\]\)/);
  assert.match(automation,/setup\.project\.ensure/);
  assert.match(content,/async function ensureProject\(projectName\)/);
  assert.match(content,/Open ChatGPT and create a Project named/);
});
