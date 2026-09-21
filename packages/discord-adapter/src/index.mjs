import { assertLogicalTarget } from '../../core/src/index.mjs';

const CHILD_SCOPE = 'discord:child';
const PARENT_SCOPE = 'discord:parent';

export class DiscordAdapterError extends Error {
  constructor(code, message = 'Discord delivery is unavailable') { super(message); this.name = 'DiscordAdapterError'; this.code = code; }
}
function required(value, label) { if (typeof value !== 'string' || !value.trim()) throw new DiscordAdapterError('INVALID_INPUT', `${label} is required`); return value.trim(); }
function publicError(error) { return error instanceof DiscordAdapterError ? error : new DiscordAdapterError('DELIVERY_FAILED'); }

/** Provider boundary: raw Discord IDs enter only here and in trusted ingress. */
export function createDiscordAdapter({ store, provider, audit = async () => {}, rateLimit = async () => true } = {}) {
  if (!store || typeof store.authenticateSession !== 'function' || typeof store.resolveDestination !== 'function') throw new Error('store is required');
  if (!provider || typeof provider.send !== 'function') throw new Error('provider.send is required');
  async function record(event) { try { await audit(Object.freeze({ ...event })); } catch { /* audit is best effort */ } }
  function authenticate({ sessionToken, familyId }) {
    let context;
    try { context = store.authenticateSession(sessionToken); } catch { context = null; }
    if (!context) throw new DiscordAdapterError('UNAUTHORIZED', 'family session is invalid or expired');
    if (familyId !== undefined && context.familyId !== required(familyId, 'familyId')) throw new DiscordAdapterError('FORBIDDEN', 'session is not authorized for this family');
    return Object.freeze(context);
  }
  function authorize(context, scope) {
    if (!context.scopes.includes('tutor') && !context.scopes.includes('*') && !context.scopes.includes(scope)) throw new DiscordAdapterError('FORBIDDEN', 'session is not authorized for this destination');
  }
  function resolveTarget(context, target, sessionToken) {
    if (target?.providerChannelId !== undefined || target?.channelId !== undefined) throw new DiscordAdapterError('INVALID_TARGET', 'raw Discord channel ids are not valid model targets');
    if (target?.childId !== undefined) {
      const logical = assertLogicalTarget(target); authorize(context, CHILD_SCOPE);
      if (context.childId !== null && context.childId !== logical.childId) throw new DiscordAdapterError('FORBIDDEN', 'session is not authorized for this child');
      const child = store.snapshot().families[context.familyId]?.children?.find(item => item.childId === logical.childId);
      if (!child) throw new DiscordAdapterError('NOT_FOUND', 'child destination is not bound for this family');
      return store.resolveDestination({ sessionToken, familyId: context.familyId, destinationType: 'child', destinationKey: child.destination.key });
    }
    if (target?.destinationType === 'parent' && target?.destinationKey === 'parent') {
      if (target.familyId !== context.familyId) throw new DiscordAdapterError('FORBIDDEN', 'session is not authorized for this family');
      if (context.childId !== null) throw new DiscordAdapterError('FORBIDDEN', 'child sessions cannot access the parent destination');
      authorize(context, PARENT_SCOPE);
      return store.resolveDestination({ sessionToken, familyId: context.familyId, destinationType: 'parent', destinationKey: 'parent' });
    }
    throw new DiscordAdapterError('INVALID_TARGET', 'target must be a logical child or parent destination');
  }
  async function send({ sessionToken, target, content, metadata = {} }) {
    const context = authenticate({ sessionToken, familyId: target?.familyId });
    const destination = resolveTarget(context, target, sessionToken);
    const action = { action: 'send', familyId: context.familyId, destinationType: destination.destinationType, childId: destination.childId ?? null };
    await record({ type: 'delivery.requested', ...action });
    try {
      if (!await rateLimit(Object.freeze(action))) throw new DiscordAdapterError('RATE_LIMITED', 'delivery rate limit exceeded');
      const result = await provider.send({ channelId: destination.providerId, content: required(content, 'content'), metadata });
      await record({ type: 'delivery.completed', ...action });
      return Object.freeze({ messageId: result?.messageId ?? null, familyId: context.familyId, destinationType: destination.destinationType, childId: destination.childId ?? null });
    } catch (error) {
      const safe = publicError(error); await record({ type: 'delivery.failed', ...action, code: safe.code }); throw safe;
    }
  }
  function receive({ sessionToken, providerChannelId }) {
    const context = authenticate({ sessionToken }); const channelId = required(providerChannelId, 'providerChannelId');
    const family = store.snapshot().families[context.familyId];
    const matches = [{ destinationType: 'parent', destinationKey: family?.parent?.key, providerId: family?.parent?.providerId, childId: null }, ...(family?.children || []).map(child => ({ destinationType: 'child', destinationKey: child.destination.key, providerId: child.destination.providerId, childId: child.childId }))].filter(route => route.providerId === channelId);
    if (matches.length !== 1) throw new DiscordAdapterError('NOT_FOUND', 'provider destination is not bound for this family');
    const { providerId: _providerId, ...logical } = matches[0]; return Object.freeze({ familyId: context.familyId, ...logical });
  }
  return Object.freeze({ authenticate, send, receive });
}
