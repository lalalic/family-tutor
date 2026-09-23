import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_MESSAGE = 12000;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function clean(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function safeContext(value, fallback = null) {
  const result = clean(value, fallback || '');
  return result ? result.slice(0, 200) : fallback;
}

function initialState() { return { schemaVersion: 1, records: [] }; }

function readState(filePath) {
  if (!filePath || !existsSync(filePath)) return initialState();
  const state = JSON.parse(readFileSync(filePath, 'utf8'));
  if (state?.schemaVersion !== 1 || !Array.isArray(state.records)) throw new Error('unsupported feedback storage schema');
  return state;
}

function createStore(filePath) {
  let state = readState(filePath);
  function persist() {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, filePath);
  }
  return {
    add(record) {
      state.records.push(record);
      persist();
      return structuredClone(record);
    },
    list() { return structuredClone(state.records); },
  };
}

/**
 * Durable public feedback intake. Records contain only tester-supplied feedback,
 * an optional screenshot, and coarse public-surface context; no child content,
 * provider identifiers, credentials, or automatic PR data is accepted.
 */
export function createFeedbackIntake({ filePath = null, clock = Date.now, idGenerator = () => `fb_${randomUUID()}`, store = null } = {}) {
  const records = store || createStore(filePath);
  return Object.freeze({
    submit(input = {}) {
      const message = clean(input.message);
      if (!message || message.length > MAX_MESSAGE) throw new Error('feedback message is required and must be at most 12000 characters');
      const screenshot = input.screenshot || null;
      if (screenshot) {
        const mediaType = clean(screenshot.mediaType).toLowerCase();
        const data = clean(screenshot.data);
        if (!IMAGE_TYPES.has(mediaType) || !data) throw new Error('screenshot must be a supported image');
        const bytes = Buffer.byteLength(data, 'base64');
        if (bytes > MAX_SCREENSHOT_BYTES) throw new Error('screenshot is too large');
      }
      return records.add({
        id: idGenerator(),
        createdAt: new Date(clock()).toISOString(),
        message,
        screenshot: screenshot ? { mediaType: clean(screenshot.mediaType).toLowerCase(), filename: safeContext(screenshot.filename, 'screenshot'), data: clean(screenshot.data) } : null,
        context: {
          page: safeContext(input.context?.page, 'unknown'),
          setupStep: safeContext(input.context?.setupStep),
          productVersion: safeContext(input.context?.productVersion),
          referrer: safeContext(input.context?.referrer),
        },
        provenance: 'public-feedback',
      });
    },
    list: () => records.list(),
  });
}

export const FEEDBACK_LIMITS = Object.freeze({ MAX_MESSAGE, MAX_SCREENSHOT_BYTES });
