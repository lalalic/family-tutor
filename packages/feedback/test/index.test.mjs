import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackIntake } from '../src/index.mjs';

test('stores a durable, contextual record without transcript fields', () => {
  const records = [];
  const intake = createFeedbackIntake({
    store: { add: record => { records.push(record); return record; }, list: () => records },
    clock: () => 0,
    idGenerator: () => 'fb_test',
  });
  const record = intake.submit({
    message: 'The setup button did not continue.',
    screenshot: { mediaType: 'image/png', filename: 'screen.png', data: Buffer.from('image').toString('base64') },
    context: { page: 'setup', setupStep: 'extension', productVersion: '2.6.12', referrer: 'https://example.test/setup' },
  });
  assert.equal(record.id, 'fb_test');
  assert.equal(record.context.setupStep, 'extension');
  assert.equal(record.screenshot.mediaType, 'image/png');
  assert.equal('transcript' in record, false);
  assert.equal(records.length, 1);
});

test('rejects missing feedback and unsupported screenshots', () => {
  const intake = createFeedbackIntake({ store: { add: x => x, list: () => [] } });
  assert.throws(() => intake.submit({}), /feedback message is required/);
  assert.throws(() => intake.submit({ message: 'x', screenshot: { mediaType: 'text/plain', data: 'x' } }), /supported image/);
});
