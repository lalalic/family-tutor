import http from 'node:http';
import { randomUUID } from 'node:crypto';

const DEFAULT_TOOLS = Object.freeze([
  {
    name: 'send_tutor_message',
    description: 'Send a message to a logical Family Tutor destination.',
    entitlement: 'core',
    scopes: ['tutor'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['destination', 'text'],
      properties: {
        destination: { type: 'object', additionalProperties: false, required: ['type', 'key'], properties: { type: { enum: ['child', 'parent'] }, key: { type: 'string', minLength: 1 } } },
        text: { type: 'string', minLength: 1, maxLength: 12000 },
      },
    },
  },
  {
    name: 'create_study_plan',
    description: 'Create a study plan for a logical Family Tutor destination.',
    entitlement: 'premium',
    scopes: ['tutor'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['destination', 'topic'],
      properties: {
        destination: { type: 'object', additionalProperties: false, required: ['type', 'key'], properties: { type: { const: 'child' }, key: { type: 'string', minLength: 1 } } },
        topic: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  },
]);

const RAW_KEYS = /^(?:familyId|tenantId|providerId|providerChannelId|discordChannelId|channelId|guildId|rawProviderId)$/i;
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
};

function walkForUnsafeSelectors(value, path = 'arguments') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (RAW_KEYS.test(key)) throw new Error(`${path}.${key} is not accepted; identity and provider routing are server-controlled`);
    walkForUnsafeSelectors(child, `${path}.${key}`);
  }
}

function validateArguments(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object');
  const schema = tool.inputSchema;
  const allowedKeys = new Set(Object.keys(schema.properties || {}));
  if (schema.additionalProperties === false) for (const key of Object.keys(args)) if (!allowedKeys.has(key)) throw new Error(`unknown argument: ${key}`);
  for (const key of schema.required || []) if (args[key] === undefined) throw new Error(`${key} is required`);
  if (typeof args.text !== 'undefined' && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 12000)) throw new Error('text must be a non-empty string of at most 12000 characters');
  if (typeof args.topic !== 'undefined' && (typeof args.topic !== 'string' || !args.topic.trim() || args.topic.length > 500)) throw new Error('topic must be a non-empty string of at most 500 characters');
  const destination = args.destination;
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) throw new Error('destination must be an object');
  if (Object.keys(destination).some(key => !['type', 'key'].includes(key))) throw new Error('destination must contain only type and key');
  if (!['child', 'parent'].includes(destination.type) || typeof destination.key !== 'string' || !destination.key.trim()) throw new Error('destination type and key are invalid');
  if (tool.name === 'create_study_plan' && destination.type !== 'child') throw new Error('study plans require a child destination');
}

function bearer(headers = {}) {
  const value = headers.authorization || headers.Authorization;
  if (typeof value !== 'string' || !/^Bearer\s+\S+$/.test(value)) return null;
  return value.replace(/^Bearer\s+/i, '');
}

function result(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function safeAudit(event) {
  return {
    at: event.at, requestId: event.requestId, action: event.action, outcome: event.outcome,
    familyId: event.familyId || null, tool: event.tool || null, destinationType: event.destinationType || null,
    destinationKey: event.destinationKey || null, reason: event.reason || null,
  };
}

/**
 * Hosted MCP boundary. The session store is the sole source of family identity;
 * request arguments can name only logical destinations within that identity.
 */
export function createHostedMcpAdapter({ store, tools = DEFAULT_TOOLS, handlers = {}, entitlements = {}, audit = () => {}, rateLimiter = () => {}, clock = Date.now } = {}) {
  if (!store?.authenticateSession || !store?.resolveDestination) throw new Error('a provisioning store is required');
  const registry = new Map(tools.map(tool => [tool.name, Object.freeze({ entitlement: 'core', scopes: ['tutor'], ...tool })]));
  const writeAudit = event => { try { audit(safeAudit(event)); } catch { /* audit failures do not leak details to callers */ } };
  const allowed = (familyId, tool) => tool.entitlement === 'core' || (Array.isArray(entitlements[familyId]) && entitlements[familyId].includes(tool.entitlement));

  async function callTool(name, args, headers = {}, requestId = cryptoRandomId()) {
    const token = bearer(headers);
    const base = { at: new Date(clock()).toISOString(), requestId, action: 'tools/call', tool: name };
    let session;
    try {
      session = store.authenticateSession(token);
      if (!session) throw new Error('authentication failed');
      const tool = registry.get(name);
      if (!tool) throw new Error('unknown tool');
      if (!allowed(session.familyId, tool)) throw new Error('tool is not enabled for this family');
      if (tool.scopes.some(scope => !session.scopes.includes(scope))) throw new Error('session scope is insufficient');
      walkForUnsafeSelectors(args);
      validateArguments(tool, args);
      const rateDecision = await rateLimiter({ familyId: session.familyId, tool: name, requestId });
      if (rateDecision === false || rateDecision?.allowed === false) throw new Error('rate limit exceeded');
      const destination = args?.destination;
      if (!destination || destination.type === undefined || destination.key === undefined) throw new Error('destination type and key are required');
      const route = store.resolveDestination({ sessionToken: token, familyId: session.familyId, destinationType: destination.type, destinationKey: destination.key });
      const handler = handlers[name];
      if (typeof handler !== 'function') throw new Error('tool is not configured');
      const value = await handler({ familyId: session.familyId, sessionId: session.sessionId, destination: route, arguments: args, requestId });
      writeAudit({ ...base, familyId: session.familyId, destinationType: route.destinationType, destinationKey: route.destinationKey, outcome: 'succeeded' });
      return result(value);
    } catch (error) {
      writeAudit({ ...base, familyId: session?.familyId, outcome: 'rejected', reason: error.message });
      return result({ error: error.message }, true);
    }
  }

  async function handle(request, { headers = {} } = {}) {
    const id = request?.id ?? null;
    try {
      if (!request || request.jsonrpc !== '2.0') return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } };
      if (request.method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'family-tutor-hosted-mcp', version: '0.1.0' } } };
      if (request.method === 'notifications/initialized') return null;
      if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
      if (request.method === 'tools/list') {
        const token = bearer(headers);
        const session = token ? store.authenticateSession(token) : null;
        if (!session) return { jsonrpc: '2.0', id, error: { code: -32001, message: 'authentication required' } };
        const visible = [...registry.values()].filter(tool => allowed(session.familyId, tool) && tool.scopes.every(scope => session.scopes.includes(scope))).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
        return { jsonrpc: '2.0', id, result: { tools: visible } };
      }
      if (request.method === 'tools/call') return { jsonrpc: '2.0', id, result: await callTool(request.params?.name, request.params?.arguments || {}, headers, String(request.id ?? cryptoRandomId())) };
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
    } catch { return { jsonrpc: '2.0', id, error: { code: -32000, message: 'request rejected' } }; }
  }

  return Object.freeze({ handle, callTool, tools: Object.freeze([...registry.values()]) });
}

function cryptoRandomId() { return `req_${randomUUID()}`; }

export function createHostedMcpServer({ adapter, host = '127.0.0.1', port = 0, maxBodyBytes = 256 * 1024 } = {}) {
  if (!adapter?.handle) throw new Error('adapter is required');
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') { res.writeHead(404); return res.end(); }
    let size = 0; const chunks = [];
    try {
      for await (const chunk of req) { size += chunk.length; if (size > maxBodyBytes) throw new Error('request body too large'); chunks.push(chunk); }
      const response = await adapter.handle(JSON.parse(Buffer.concat(chunks).toString('utf8')), { headers: req.headers });
      if (response === null) { res.writeHead(202); return res.end(); }
      const data = Buffer.from(JSON.stringify(response)); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': data.length }); res.end(data);
    } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'request rejected' })); }
  });
  return { server, start: () => new Promise(resolve => server.listen(port, host, resolve)), close: () => new Promise(resolve => server.close(resolve)), endpoint: () => `http://${host}:${server.address()?.port ?? port}/mcp` };
}
