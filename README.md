# Family Tutor

Family Tutor is a customer-ready foundation for a personalized family AI tutor.
Each child has a separate ChatGPT Project/thread and private Discord destination;
parents receive concise learning telemetry rather than routine transcripts. The
family owns its ChatGPT account, Projects, and Discord server. Family Tutor owns
the extension, hosted connectivity/routing, shared Discord bot integration,
setup, support, and any explicitly entitled premium tools.

This is not an education-content SaaS, curriculum marketplace, or replacement
for the customer's ChatGPT intelligence. The hosted components are intentionally
thin infrastructure. No local MCP federation, per-family domain, or raw
provider/channel routing is part of the commercial boundary.

## What is implemented

- `packages/core`: authenticated family/session provisioning, logical
  child/parent routing, provider binding storage, suspension, revocation, and
  transcript-free state validation.
- `packages/discord-adapter`: shared Discord transport boundary. It accepts
  authenticated logical destinations and resolves provider IDs only inside the
  trusted adapter, with audit and rate-limit hooks.
- `packages/hosted-mcp-adapter`: authenticated `/mcp` service with core/premium
  tool entitlements, scope checks, rate limits, redacted audit events, and
  `/healthz`/`/readyz` endpoints.
- `packages/onboarding`: resumable, no-JSON-editing setup flow for ChatGPT
  Developer Mode, the shared bot, logical destinations, child Projects,
  extension health, and same-origin acceptance probes.
- `packages/integration`: canonical hosted product composition. It connects
  provisioning, onboarding, extension readiness, hosted MCP, Discord delivery,
  lifecycle controls, and `/healthz`/`/readyz` in one runtime path.
- `skills/family-tutor/extension`: unpacked Chrome Manifest V3 adapter for
  deterministic child-to-Project binding, recovery, and diagnostics.
- `skills/family-tutor/`: reusable local tutoring runtime for an operator's
  private instance; real family data belongs only under ignored `runs/`.
- `site/`: dependency-free promotion site for the five-family founding pilot.

The central safety invariant is: authenticate the family, authorize the scope,
resolve a logical destination, then touch a provider ID. Model/tool callers must
never supply a raw Discord channel ID or another family's identifier.

## Documentation map

Start with [`docs/architecture.md`](docs/architecture.md) for the shared
service boundaries, then use [`docs/onboarding.md`](docs/onboarding.md) for the
customer path. [`docs/tenant-routing.md`](docs/tenant-routing.md),
[`docs/discord-adapter.md`](docs/discord-adapter.md), and
[`docs/hosted-mcp-adapter.md`](docs/hosted-mcp-adapter.md) define the security
contracts. [`docs/extension.md`](docs/extension.md) covers browser release and
recovery behavior; [`docs/operations.md`](docs/operations.md) covers deployment,
state, logging, backup, and incidents. Pilot execution is in
[`docs/launch-checklist.md`](docs/launch-checklist.md) and
[`docs/support-runbook.md`](docs/support-runbook.md); privacy communication is
in [`docs/privacy-consent.md`](docs/privacy-consent.md).

## Development and verification

The repository is deliberately split into small, independently testable
packages. Run the full release gate from the root:

```bash
npm run check
git diff --check
```

`npm run check` runs package checks, integration isolation tests, operations
redaction tests, MCP/Discord adapter tests, onboarding tests, and extension
syntax/protocol tests. The production release gate also requires a real Discord
acceptance run with distinct probes for each child; service health or direct
backend probes alone are insufficient. See [`e2e.md`](e2e.md).

The product-level synthetic gate can be run independently with
`npm run check:product`; it is also included in `npm run check`.

## Private local instance

The local tutoring runtime is an operator/development path, not the hosted
multi-family service. Keep family configuration, learner memory, Discord IDs,
credentials, and thread state under ignored `runs/family/`:

```bash
node skills/family-tutor/scripts/init-instance.mjs runs/family
node skills/family-tutor/scripts/doctor.mjs runs/family
node skills/family-tutor/scripts/service.mjs start runs/family
```

Never commit real family configuration, learner details, transcripts, tokens,
or runtime state. Each learner has one durable `runs/family/<child-id>/AGENTS.md`;
Codex owns conversation history and the runtime stores only the current thread
binding.

## Commercial deployment boundary

Deploy the hosted MCP and shared Discord adapters behind TLS, a transactional
provisioning store, platform-managed secrets, and process supervision. The
repository contains implementation contracts and a static promotion site; it
does not contain production credentials, DNS ownership, legal approval, or a
claim that Cloudflare has already been deployed. See
[`docs/promotion-site.md`](docs/promotion-site.md) for the intended
`family-tutor.qili2.com` Pages deployment and its owner-controlled blockers.
