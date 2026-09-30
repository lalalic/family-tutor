import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');

test('warm content path re-resolves live composer and uses one Send click', () => {
  assert.match(source, /async function fillLiveComposer/);
  assert.match(source, /const live = composer\(\)/);
  assert.match(source, /await fillLiveComposer\(message\.prompt\)/);
  assert.match(source, /await waitForEnabledSend\(message\.prompt\)/);
  assert.doesNotMatch(source, /requestSubmit\(button\)/);
});

test('warm content path serializes turns in one open tab', () => {
  assert.match(source, /let activeCorrelationId = null/);
  assert.match(source, /tab already processing turn/);
  assert.match(source, /activeCorrelationId = correlationId/);
  assert.match(source, /activeCorrelationId = null/);
});
