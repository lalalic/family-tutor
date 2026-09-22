import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

test('setup page is wired to automatic family claim',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.version,'2.6.3');
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
