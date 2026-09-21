const SECRET_KEYS = /token|secret|password|authorization|cookie|transcript|message|content|history|text|body/i;
const PROVIDER_KEYS = /provider|channel|guild/i;
const REQUIRED_STORAGE = 'FAMILY_TUTOR_STORAGE_PATH';

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

/** Load deployment configuration without ever returning secret values. */
export function loadProductionConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'production';
  if (!['production', 'staging', 'test'].includes(nodeEnv)) throw new Error('NODE_ENV is invalid');
  const storagePath = required(env[REQUIRED_STORAGE], REQUIRED_STORAGE);
  const maxBodyBytes = Number(env.FAMILY_TUTOR_MAX_BODY_BYTES || 262144);
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 10 * 1024 * 1024) throw new Error('FAMILY_TUTOR_MAX_BODY_BYTES is invalid');
  const host = env.HOST || env.FAMILY_TUTOR_HOST || '127.0.0.1';
  const port = Number(env.PORT || env.FAMILY_TUTOR_PORT || 8080);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  return Object.freeze({
    nodeEnv,
    storagePath,
    maxBodyBytes,
    host,
    port,
    auditSink: env.FAMILY_TUTOR_AUDIT_SINK || 'stdout',
    publicOrigin: env.FAMILY_TUTOR_PUBLIC_ORIGIN || null,
  });
}

function redact(value, key = '') {
  if (SECRET_KEYS.test(key)) return '[redacted]';
  if (PROVIDER_KEYS.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  return value;
}

/** Structured logger safe for routine production telemetry. */
export function createSafeLogger(write = line => console.log(line)) {
  return Object.freeze({
    log(event = {}) {
      const safe = redact({ at: new Date().toISOString(), ...event });
      write(JSON.stringify(safe));
      return safe;
    },
  });
}

export function createReadinessChecks({ storage, provider } = {}) {
  return Object.freeze({
    health: async () => ({ status: 'ok' }),
    ready: async () => {
      if (!storage || typeof storage.snapshot !== 'function') return { status: 'unavailable' };
      if (!provider || typeof provider.send !== 'function') return { status: 'unavailable' };
      return { status: 'ready' };
    },
  });
}
