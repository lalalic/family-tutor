import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function safeChildren(store, familyId) {
  return (store.snapshot().families?.[familyId]?.children || []).map(child => child.childId).sort();
}

function kidContext(childId, correlationId, text) {
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({
    type: 'kid',
    data: { childId, correlationId, studentMessage: String(text || '') },
  })}\n</FAMILY_TUTOR_CONTEXT>`;
}

export function createHostedExtensionRelay({ store, provider, path = '/extension', turnTtlMs = 15 * 60 * 1000, clock = Date.now } = {}) {
  if (!store?.authenticateSession) throw new Error('store is required');
  if (!provider?.send) throw new Error('provider.send is required');
  const sockets = new Map();
  const socketState = new WeakMap();
  const correlations = new Map();
  const completedCorrelations = new Map();
  let wss = null;
  let cleanupTimer = null;

  function key(familyId, childId) { return `${familyId}\u0000${childId}`; }

  function status({ familyId, children = safeChildren(store, familyId) } = {}) {
    const boundChildren = children.filter(childId => sockets.get(key(familyId, childId))?.readyState === WebSocket.OPEN);
    return Object.freeze({ ok: children.length > 0 && boundChildren.length === children.length, familyId, children: [...children], boundChildren });
  }

  function authenticate(token) {
    const session = store.authenticateSession(token);
    if (!session || !session.scopes.includes('tutor')) return null;
    return session;
  }

  function bind(socket, childId, version = '0.0.0') {
    const state = socketState.get(socket);
    if (!state?.session) throw new Error('extension session is not authenticated');
    const id = required(childId, 'childId');
    if (!safeChildren(store, state.session.familyId).includes(id)) throw new Error('unknown child');
    if (state.session.childId !== null && state.session.childId !== id) throw new Error('session is not authorized for this child');
    const bindingKey = key(state.session.familyId, id);
    const prior = sockets.get(bindingKey);
    if (prior && prior !== socket && prior.readyState === WebSocket.OPEN) prior.close(4000, 'child rebound');
    sockets.set(bindingKey, socket);
    state.children.add(id);
    state.version = String(version || '0.0.0');
    return id;
  }

  function payload(turn) {
    return {
      type: 'turn',
      childId: turn.childId,
      prompt: kidContext(turn.childId, turn.correlationId, turn.text),
      correlation: { correlationId: turn.correlationId },
      attachments: [],
    };
  }

  function dispatch(turn) {
    const socket = sockets.get(key(turn.familyId, turn.childId));
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('child extension is not connected');
    socket.send(JSON.stringify(payload(turn)));
  }

  async function ingest({ route, providerChannelId, text = '', messageId = null }) {
    if (!route || route.destinationType !== 'child' || !route.childId) throw new Error('only child Discord destinations can start tutor turns');
    const correlationId = randomUUID();
    const turn = {
      correlationId,
      familyId: route.familyId,
      childId: route.childId,
      providerChannelId: required(providerChannelId, 'providerChannelId'),
      messageId,
      text: String(text || ''),
      expiresAt: clock() + turnTtlMs,
    };
    correlations.set(correlationId, turn);
    try { dispatch(turn); } catch (error) { correlations.delete(correlationId); throw error; }
    return Object.freeze({ correlationId, familyId: route.familyId, childId: route.childId });
  }

  async function reply({ familyId, childId = null, correlationId, text, final = true }) {
    const id = required(correlationId, 'correlationId');
    const turn = correlations.get(id);
    if (!turn || turn.expiresAt <= clock()) {
      correlations.delete(id);
      const completed = completedCorrelations.get(id);
      if (!completed || completed.expiresAt <= clock() || final === false) {
        completedCorrelations.delete(id);
        throw new Error('correlation is unavailable');
      }
      if (completed.familyId !== familyId) throw new Error('correlation is not authorized for this family');
      if (childId !== null && completed.childId !== childId) throw new Error('correlation is not authorized for this child');
      return Object.freeze({ messageId: completed.messageId, familyId: completed.familyId, childId: completed.childId, final: true, duplicate: true });
    }
    if (turn.familyId !== familyId) throw new Error('correlation is not authorized for this family');
    if (childId !== null && turn.childId !== childId) throw new Error('correlation is not authorized for this child');
    const content = required(text, 'text');
    const result = await provider.send({ channelId: turn.providerChannelId, content, metadata: { replyToMessageId: turn.messageId, correlationId: id } });
    if (final !== false) {
      correlations.delete(id);
      completedCorrelations.set(id, {
        familyId: turn.familyId, childId: turn.childId, messageId: result?.messageId ?? null, expiresAt: clock() + turnTtlMs,
      });
    }
    return Object.freeze({ messageId: result?.messageId ?? null, familyId: turn.familyId, childId: turn.childId, final: final !== false });
  }

  function cleanup() {
    const now = clock();
    for (const [id, turn] of correlations) if (turn.expiresAt <= now) correlations.delete(id);
    for (const [id, turn] of completedCorrelations) if (turn.expiresAt <= now) completedCorrelations.delete(id);
  }

  function attach(server) {
    if (!server?.on) throw new Error('http server is required');
    if (wss) throw new Error('extension relay is already attached');
    wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { socket.destroy(); return; }
      if (url.pathname !== path) return;
      wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client));
    });
    wss.on('connection', socket => {
      const state = { session: null, children: new Set(), version: '0.0.0' };
      socketState.set(socket, state);
      socket.send(JSON.stringify({ type: 'bridge.auth.required' }));
      socket.on('message', raw => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { socket.close(4001, 'invalid message'); return; }
        try {
          if (message?.type === 'bridge.auth') {
            const session = authenticate(String(message.token || ''));
            if (!session) throw new Error('authentication failed');
            state.session = session;
            socket.send(JSON.stringify({ type: 'bridge.ready', children: safeChildren(store, session.familyId) }));
            return;
          }
          if (!state.session) throw new Error('authentication required');
          if (message?.type === 'extension.ping' || message?.type === 'turn.ack') return;
          if (message?.type === 'tab.bind') { bind(socket, message.childId, message.version); return; }
          if (message?.type === 'turn.error') return;
        } catch {
          socket.close(4003, 'request rejected');
        }
      });
      socket.on('close', () => {
        for (const childId of state.children) if (sockets.get(key(state.session?.familyId, childId)) === socket) sockets.delete(key(state.session.familyId, childId));
      });
    });
    cleanupTimer = setInterval(cleanup, Math.min(60_000, turnTtlMs));
    cleanupTimer.unref?.();
    return path;
  }

  async function close() {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    if (!wss) return;
    for (const socket of wss.clients) socket.close();
    await new Promise(resolve => wss.close(resolve));
    wss = null;
  }

  return Object.freeze({ attach, close, status, ingest, reply, cleanup });
}
