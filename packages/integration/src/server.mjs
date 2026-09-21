import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createProductionFamilyTutorProduct } from './index.mjs';

async function loadProvider(specifier, env) {
  if (!specifier) throw new Error('FAMILY_TUTOR_PROVIDER_MODULE is required');
  const target = specifier.startsWith('.') || specifier.startsWith('/')
    ? pathToFileURL(resolve(specifier)).href
    : specifier;
  const module = await import(target);
  const provider = typeof module.createProvider === 'function'
    ? await module.createProvider({ env })
    : module.default;
  if (!provider || typeof provider.send !== 'function') throw new Error('provider module must export createProvider() or default provider with send()');
  return provider;
}

const provider = await loadProvider(process.env.FAMILY_TUTOR_PROVIDER_MODULE, process.env);
const product = createProductionFamilyTutorProduct({ provider, env: process.env });

if (typeof provider.start === 'function') {
  await provider.start({
    onMessage: message => product.ingestDiscordMessage({
      providerChannelId: message.providerChannelId,
      text: message.text || '',
      messageId: message.messageId || null,
    }),
  });
}

await product.server.start();
console.log(`[family-tutor] hosted product listening on ${product.server.endpoint()}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { if (typeof provider.close === 'function') await provider.close(); } finally { await product.close(); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown().finally(() => process.exit(0)));
