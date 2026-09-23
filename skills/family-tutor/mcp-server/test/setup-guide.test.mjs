import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPublicSetupPage, renderSetupPage } from '../src/setup-guide.mjs';

test('public setup guide links feedback with the selected step and product version', () => {
  const html = renderPublicSetupPage({ publicOrigin: 'https://family-tutor.example', step: 'extension' });
  assert.match(html, /feedback\.html\?page=setup&amp;setupStep=extension&amp;productVersion=2\.6\.12/);
  assert.match(html, /Send setup feedback/);
});

test('claim setup guide preserves its current step in the feedback link', () => {
  const html = renderSetupPage({ claim: 'short-lived-claim', publicOrigin: 'https://family-tutor.example', step: 'projects' });
  assert.match(html, /feedback\.html\?page=setup&amp;setupStep=projects&amp;productVersion=2\.6\.12/);
  assert.doesNotMatch(html, /short-lived-claim.*feedback/);
});
