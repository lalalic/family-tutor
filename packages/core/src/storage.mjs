import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRouteIndex } from './routing.mjs';

const SCHEMA_VERSION = 1;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SECRET_FIELDS = new Set(['transcript', 'transcripts', 'messages', 'message', 'content', 'history']);

function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value.trim();
}
function id(value, label) {
  const result = text(value, label);
  if (!ID.test(result)) throw new Error(`${label} has an invalid format`);
  return result;
}
function timestamp(clock) { return new Date(clock()).toISOString(); }
function rejectTranscriptFields(value, path = 'record') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELDS.has(key.toLowerCase())) throw new Error(`${path}.${key} is not stored by family-tutor`);
    rejectTranscriptFields(child, `${path}.${key}`);
  }
}
function emptyState() { return { schemaVersion: SCHEMA_VERSION, families: {}, sessions: {} }; }
function validateState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.families || !state.sessions) throw new Error(`unsupported storage schema; expected version ${SCHEMA_VERSION}`);
  rejectTranscriptFields(state);
  return state;
}
function hashToken(token) { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function newId(prefix) { return `${prefix}_${randomBytes(18).toString('base64url')}`; }
function clone(value) { return structuredClone(value); }

/**
 * Persistent provisioning state. It stores family metadata, provider
 * bindings, and session hashes only; child messages/transcripts are rejected.
 */
export function createProvisioningStore({ filePath = null, clock = Date.now, idGenerator = newId } = {}) {
  let state = filePath && existsSync(filePath) ? validateState(JSON.parse(readFileSync(filePath, 'utf8'))) : emptyState();
  function persist() {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, filePath);
  }
  function mutate(action) { const result = action(); validateState(state); persist(); return result; }
  function family(familyId) {
    const result = state.families[id(familyId, 'familyId')];
    if (!result) throw new Error('family is not provisioned');
    return result;
  }
  function sessionFor(token) {
    const value = text(token, 'session token');
    const digest = hashToken(value);
    const record = Object.values(state.sessions).find(candidate => candidate.tokenHash === digest);
    if (!record || record.revokedAt || new Date(record.expiresAt).getTime() <= clock()) return null;
    if (!timingSafeEqual(Buffer.from(record.tokenHash), Buffer.from(digest))) return null;
    return record;
  }
  function requireSession(token, requestedFamilyId = null) {
    const record = sessionFor(token);
    if (!record) throw new Error('session is invalid or expired');
    if (requestedFamilyId !== null && record.familyId !== id(requestedFamilyId, 'familyId')) throw new Error('session is not authorized for this family');
    return record;
  }
  const api = {
    provisionFamily(options) {
      rejectTranscriptFields(options, 'provisionFamily');
      const { familyId, parentProviderId, parentKey = 'parent' } = options;
      return mutate(() => {
        const normalizedId = id(familyId, 'familyId');
        if (state.families[normalizedId]) throw new Error(`family already exists: ${normalizedId}`);
        const now = timestamp(clock);
        state.families[normalizedId] = { familyId: normalizedId, status: 'active', createdAt: now, updatedAt: now, parent: { key: text(parentKey, 'parent destination key'), providerId: text(parentProviderId, 'parentProviderId') }, children: [] };
        return clone(state.families[normalizedId]);
      });
    },
    provisionChild(options) {
      rejectTranscriptFields(options, 'provisionChild');
      const { familyId, childId, providerId, destinationKey = childId } = options;
      return mutate(() => {
        const record = family(familyId);
        if (record.status !== 'active') throw new Error('family is not active');
        const normalizedChild = id(childId, 'childId');
        if (record.children.some(child => child.childId === normalizedChild)) throw new Error(`child already exists: ${normalizedChild}`);
        const key = text(destinationKey, 'child destination key');
        if (key === record.parent.key || record.children.some(child => child.destination.key === key)) throw new Error(`duplicate destination key: ${key}`);
        record.children.push({ childId: normalizedChild, destination: { key, providerId: text(providerId, 'providerId') } });
        record.updatedAt = timestamp(clock);
        return clone(record.children.at(-1));
      });
    },
    removeChild(options) {
      rejectTranscriptFields(options, 'removeChild');
      const { familyId, childId } = options;
      return mutate(() => {
        const record = family(familyId);
        const normalizedChild = id(childId, 'childId');
        const index = record.children.findIndex(child => child.childId === normalizedChild);
        if (index < 0) throw new Error('child is not provisioned');
        const [removed] = record.children.splice(index, 1);
        record.updatedAt = timestamp(clock);
        return clone(removed);
      });
    },
    suspendFamily(familyId) { return mutate(() => { const record = family(familyId); record.status = 'suspended'; record.updatedAt = timestamp(clock); return clone(record); }); },
    activateFamily(familyId) { return mutate(() => { const record = family(familyId); record.status = 'active'; record.updatedAt = timestamp(clock); return clone(record); }); },
    createSession(options) {
      rejectTranscriptFields(options, 'createSession');
      const { familyId, ttlMs = DEFAULT_SESSION_TTL_MS, scopes = ['tutor'] } = options;
      return mutate(() => {
        const record = family(familyId);
        if (record.status !== 'active') throw new Error('family is not active');
        if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 24 * 60 * 60 * 1000) throw new Error('ttlMs is out of range');
        if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string' || !scope.trim())) throw new Error('scopes must be non-empty strings');
        const token = idGenerator('session');
        const sessionId = id(idGenerator('sid'), 'sessionId');
        const createdAt = timestamp(clock);
        const expiresAt = new Date(clock() + ttlMs).toISOString();
        state.sessions[sessionId] = { sessionId, familyId: record.familyId, tokenHash: hashToken(token), scopes: [...new Set(scopes)], createdAt, expiresAt, revokedAt: null };
        return { sessionId, familyId: record.familyId, token, scopes: [...new Set(scopes)], createdAt, expiresAt };
      });
    },
    authenticateSession(token) {
      const record = sessionFor(token);
      if (!record || state.families[record.familyId]?.status !== 'active') return null;
      return clone({ sessionId: record.sessionId, familyId: record.familyId, scopes: record.scopes, expiresAt: record.expiresAt });
    },
    revokeSession(sessionId) { return mutate(() => { const record = state.sessions[id(sessionId, 'sessionId')]; if (!record) throw new Error('session is not found'); record.revokedAt = timestamp(clock); return { sessionId: record.sessionId, revokedAt: record.revokedAt }; }); },
    resolveDestination(options) {
      rejectTranscriptFields(options, 'resolveDestination');
      const { sessionToken, familyId, destinationType, destinationKey } = options;
      const session = requireSession(sessionToken, familyId);
      const record = family(session.familyId);
      if (record.status !== 'active') throw new Error('family is not active');
      return createRouteIndex([record]).resolve({ familyId: session.familyId, destinationType, destinationKey });
    },
    snapshot() { const safe = clone(state); for (const session of Object.values(safe.sessions)) delete session.tokenHash; return safe; },
  };
  return Object.freeze(api);
}

export { SCHEMA_VERSION };
