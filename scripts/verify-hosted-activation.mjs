const origin = (process.env.FAMILY_TUTOR_PUBLIC_ORIGIN || process.env.HOSTED_ACTIVATION_ORIGIN || '').replace(/\/+$/, '');

if (!origin) {
  console.error('Set FAMILY_TUTOR_PUBLIC_ORIGIN or HOSTED_ACTIVATION_ORIGIN to the deployed HTTPS origin.');
  process.exit(2);
}

let base;
try {
  base = new URL(origin);
} catch {
  console.error('Hosted activation origin must be a valid URL.');
  process.exit(2);
}
if (base.protocol !== 'https:') {
  console.error('Hosted activation requires an HTTPS origin; local HTTP rehearsals are covered by npm run check:product.');
  process.exit(2);
}

const checks = [
  ['/healthz', response => response.status === 200 && response.body === '{"status":"ok"}'],
  ['/readyz', response => response.status === 200 && response.body === '{"status":"ready"}'],
  ['/bootstrap/latest.md', response => response.status === 200 && /You are \*\*Neo\*\*/.test(response.body) && !/\b(?:token|secret)\s*[:=]/i.test(response.body)],
];

let failed = false;
for (const [path, validate] of checks) {
  const url = new URL(path, base);
  try {
    const response = await fetch(url);
    const body = await response.text();
    const result = { status: response.status, body };
    if (!validate(result)) {
      failed = true;
      console.error(`FAIL ${path}: unexpected response (${response.status})`);
    } else {
      console.log(`PASS ${path}: ${response.status}`);
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${path}: ${error instanceof Error ? error.message : 'request failed'}`);
  }
}

if (failed) {
  console.error('Hosted public activation probes failed. Do not enable customer traffic.');
  process.exit(1);
}
console.log('Hosted public activation probes passed. Complete authenticated MCP, extension, and real Discord acceptance before launch.');
