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
const EXPORT_SCOPE = 'family:export';
const DELETE_SCOPE = 'family:delete';

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
  function requireLifecycleSession(token, requestedFamilyId, scope, childId = null) {
    const session = requireSession(token, requestedFamilyId);
    if (!session.scopes.includes(scope)) throw new Error(`session scope is insufficient for ${scope}`);
    if (session.childId !== null && session.childId !== childId) throw new Error('session is not authorized for this child');
    if (childId === null && session.childId !== null) throw new Error('session is not authorized for the family');
    return session;
  }
  function redactedFamily(record, sessions, childId = null) {
    const children = childId === null ? record.children : record.children.filter(child => child.childId === childId);
    return {
      familyId: record.familyId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      parent: childId === null ? { key: record.parent.key } : null,
      children: children.map(child => ({ childId: child.childId, destinationKey: child.destination.key })),
      sessions: sessions.filter(session => childId === null || session.childId === childId).map(session => ({
        sessionId: session.sessionId, childId: session.childId ?? null, scopes: [...session.scopes],
        createdAt: session.createdAt, expiresAt: session.expiresAt, revokedAt: session.revokedAt,
      })),
      redaction: 'Provider identifiers, bearer-token hashes, learner content, and external provider data are excluded.',
    };
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
      const { familyId, childId = null, ttlMs = DEFAULT_SESSION_TTL_MS, scopes = ['tutor'] } = options;
      return mutate(() => {
        const record = family(familyId);
        if (record.status !== 'active') throw new Error('family is not active');
        const normalizedChild = childId === null ? null : id(childId, 'childId');
        if (normalizedChild !== null && !record.children.some(child => child.childId === normalizedChild)) throw new Error('child is not provisioned');
        if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 24 * 60 * 60 * 1000) throw new Error('ttlMs is out of range');
        if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string' || !scope.trim())) throw new Error('scopes must be non-empty strings');
        const token = idGenerator('session');
        const sessionId = id(idGenerator('sid'), 'sessionId');
        const createdAt = timestamp(clock);
        const expiresAt = new Date(clock() + ttlMs).toISOString();
        state.sessions[sessionId] = { sessionId, familyId: record.familyId, childId: normalizedChild, tokenHash: hashToken(token), scopes: [...new Set(scopes)], createdAt, expiresAt, revokedAt: null };
        return { sessionId, familyId: record.familyId, childId: normalizedChild, token, scopes: [...new Set(scopes)], createdAt, expiresAt };
      });
    },
    authenticateSession(token) {
      const record = sessionFor(token);
      if (!record || state.families[record.familyId]?.status !== 'active') return null;
      return clone({ sessionId: record.sessionId, familyId: record.familyId, childId: record.childId ?? null, scopes: record.scopes, expiresAt: record.expiresAt });
    },
    purgeExpiredSessions({ retentionMs = 0 } = {}) {
      if (!Number.isInteger(retentionMs) || retentionMs < 0) throw new Error('retentionMs must be a non-negative integer');
      const cutoff = clock() - retentionMs;
      const expired = Object.values(state.sessions).filter(session => new Date(session.expiresAt).getTime() <= cutoff).map(session => session.sessionId);
      if (!expired.length) return { sessionsRemoved: 0, retentionMs };
      return mutate(() => {
        for (const sessionId of expired) delete state.sessions[sessionId];
        return { sessionsRemoved: expired.length, retentionMs };
      });
    },
    revokeSession(sessionId) { return mutate(() => { const record = state.sessions[id(sessionId, 'sessionId')]; if (!record) throw new Error('session is not found'); record.revokedAt = timestamp(clock); return { sessionId: record.sessionId, revokedAt: record.revokedAt }; }); },
    exportFamily({ sessionToken, familyId }) {
      const session = requireLifecycleSession(sessionToken, familyId, EXPORT_SCOPE);
      return redactedFamily(family(session.familyId), Object.values(state.sessions).filter(candidate => candidate.familyId === session.familyId));
    },
    exportChild({ sessionToken, familyId, childId }) {
      const normalizedChild = id(childId, 'childId');
      const session = requireLifecycleSession(sessionToken, familyId, EXPORT_SCOPE, normalizedChild);
      const record = family(session.familyId);
      if (!record.children.some(child => child.childId === normalizedChild)) throw new Error('child is not provisioned');
      return redactedFamily(record, Object.values(state.sessions).filter(candidate => candidate.familyId === session.familyId), normalizedChild);
    },
    deleteFamily({ sessionToken, familyId, confirmFamilyId, dryRun = false }) {
      const session = requireLifecycleSession(sessionToken, familyId, DELETE_SCOPE);
      if (confirmFamilyId !== session.familyId) throw new Error('confirmation does not match familyId');
      const record = family(session.familyId);
      const sessionIds = Object.values(state.sessions).filter(candidate => candidate.familyId === session.familyId).map(candidate => candidate.sessionId);
      const result = { familyId: session.familyId, childrenRemoved: record.children.length, sessionsRemoved: sessionIds.length, providerBindingsRemoved: record.children.length + 1, dryRun: Boolean(dryRun) };
      if (!dryRun) return mutate(() => { delete state.families[session.familyId]; for (const sessionId of sessionIds) delete state.sessions[sessionId]; return result; });
      return result;
    },
    deleteChild({ sessionToken, familyId, childId, confirmChildId, dryRun = false }) {
      const normalizedChild = id(childId, 'childId');
      const session = requireLifecycleSession(sessionToken, familyId, DELETE_SCOPE, normalizedChild);
      if (confirmChildId !== normalizedChild) throw new Error('confirmation does not match childId');
      const record = family(session.familyId);
      if (!record.children.some(child => child.childId === normalizedChild)) throw new Error('child is not provisioned');
      const sessionIds = Object.values(state.sessions).filter(candidate => candidate.familyId === session.familyId && candidate.childId === normalizedChild).map(candidate => candidate.sessionId);
      const result = { familyId: session.familyId, childId: normalizedChild, childrenRemoved: 1, sessionsRemoved: sessionIds.length, providerBindingsRemoved: 1, dryRun: Boolean(dryRun) };
      if (!dryRun) return mutate(() => { record.children = record.children.filter(child => child.childId !== normalizedChild); record.updatedAt = timestamp(clock); for (const sessionId of sessionIds) delete state.sessions[sessionId]; return result; });
      return result;
    },
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
