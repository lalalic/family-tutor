# Commercial readiness audit — 2026-09-23

## Verdict

**No-go for accepting a first paying external family.** The repository has a
strong product foundation and the public hostname is partially live, but the
evidence does not establish a complete, supportable production path. The
blocking gaps are operational readiness, current real-family acceptance,
commercial/payment approval, and approved privacy/consent operations.

This is an evidence audit, not a claim that a documented capability is live.
The checks below were run from the repository checkout on 2026-09-23.

## Evidence observed

### Public surface and hosted boundary

- `https://family-tutor.qili2.com/` returns `200` from Cloudflare and serves the
  promotion site.
- `/privacy-consent.html`, `/robots.txt`, and `/sitemap.xml` return `200`.
- `/discord/install` reaches the Discord OAuth authorization flow and returns a
  one-time setup state. This confirms a reachable install entry point, not a
  completed family onboarding.
- The live MCP boundary is reachable: `/mcp` returns the expected unauthenticated
  `401`; OAuth discovery endpoints return metadata; `/oauth/authorize` and
  `/oauth/token` respond with the hosted service's JSON errors.
- `/setup` and `/bootstrap/latest.md` return `200`. The claim-specific setup
  behavior was not exercised because no authenticated family claim was
  available for this audit.
- `/healthz` and `/readyz` return `404` at the public hostname, so public
  liveness/readiness cannot be verified there. The documented
  `/v1/learner-profile-template` route also returns `404`, while the protected
  `/v1/setup/status` route returns `401` without a session. The documented
  plain `GET /extension` route returns `404`; the actual `/ws` path returns the
  expected unauthenticated `401`, but no authenticated WebSocket upgrade was
  available to verify from this audit.
- The public extension ZIPs `family-tutor-extension-2.6.7.zip`,
  `family-tutor-extension-2.6.12.zip`, and the unversioned download all return
  `200` and are downloadable. The repository manifest is version `2.6.12`, so
  the current artifact is available, although the older 2.6.7 artifact remains
  publicly reachable. No Chrome Web Store listing or managed update path is
  present in the repository.

### Repository, CI, and local runtime

- `npm run check` passes locally: package, product-composition, onboarding,
  operations, MCP-server, orchestrator, extension, and Cloudflare ASR tests
  all passed. `git diff --check` also passes.
- The GitHub `check.yml` workflow has a successful run for the current `main`
  commit. The workflow runs tests only; it does not deploy the hosted service,
  configure secrets, verify a Pages/worker deployment, or run real Discord
  acceptance.
- The local PM2 inventory shows `family-tutor-orchestrator` online and
  `family-tutor-site`/tunnel processes online, but `family-tutor-bridge` is
  stopped. Local PM2 status is not evidence that the shared hosted commercial
  service is deployed or healthy.
- The source implements authenticated family/session provisioning, logical
  routing, scoped MCP tools, rate-limit/audit hooks, lifecycle operations,
  health/readiness handlers, onboarding, and extension packaging. These are
  implementation evidence, not deployment evidence.

### Premium, payment, and measurement

- The hosted MCP registry implements the premium `create_study_plan` tool and
  requires an explicit family entitlement. Core tools and entitlement checks
  are covered by tests.
- No Stripe, PayPal, checkout, invoice, subscription, payment webhook, or
  payment-to-entitlement integration was found. There is no approved price,
  refund/credit policy, or payment path in the repository.
- The promotion site is intentionally dependency-free and has no analytics
  SDK, cookies, child forms, or third-party tracking. No product measurement
  implementation or durable aggregate records for setup completion,
  activation, usage, retention, support burden, or payment were found.

### Privacy, consent, support, and recovery

- The repository has a coherent privacy contract: private child destinations,
  parent learning telemetry rather than transcript mirroring, minimum-necessary
  safety escalation, scoped export/delete operations, redacted logs, and
  logical-destination isolation.
- `docs/privacy-consent.md`, `docs/launch-checklist.md`, and
  `docs/support-runbook.md` explicitly leave guardian consent language, terms,
  retention schedule, incident notification, pricing, support hours, and
  owner/counsel approval open.
- Operations documentation requires transactional hosted storage, platform
  secret management, encrypted snapshots, restore rehearsal, alert ownership,
  and deployment verification. No repository evidence or accessible deployment
  evidence proves those controls are configured for the live service.

### Real acceptance

- Synthetic isolation and product tests pass locally, including cross-family,
  cross-child, raw-provider-id, session, entitlement, rate-limit, and redaction
  checks.
- The real Discord/ChatGPT acceptance path was not independently completed in
  this audit: no signed-in customer ChatGPT session, real family claim,
  distinct child probes, parent telemetry check, or export/deletion rehearsal
  was available. Historical release notes describe such checks, but they are
  not current reproducible evidence for this audit.

## Exact remaining work

### P0 — must close before charging a family

1. Deploy and verify one coherent hosted product path. Make the custom hostname
   route `/mcp`, OAuth, `/extension`, `/setup`, `/healthz`, `/readyz`, and the
   documented bootstrap/setup resources consistently, or update the canonical
   guide to the actual split-host architecture. Capture authenticated and
   unauthenticated probe evidence.
2. Establish deployment operations: transactional production store, secret
   manager, TLS/DNS ownership, process supervision/restart, encrypted backup,
   restore rehearsal, alert destinations/owner, and rollback procedure.
3. Publish a current external extension artifact and verify its SHA/version.
   Decide whether the pilot uses a versioned self-hosted ZIP or Chrome Web
   Store distribution; document update/revocation behavior.
4. Run the real acceptance gate from `e2e.md` with an authorized pilot family:
   distinct child probes, exact-origin replies, parent telemetry, targeted
   parent-to-child action, cross-family/cross-child rejection, expired/revoked
   session behavior, and export/dry-run deletion. Record only safe IDs and
   pass/fail results.
5. Approve one commercial offer and implement its payment-to-entitlement
   path. Pricing, refund/credit policy, and any materially different
   monetization model require owner approval before implementation.
6. Obtain owner/counsel approval for market, guardian-consent, terms, safety
   escalation, retention, incident notification, support SLA, and deletion/export
   wording. Update the public privacy page and pilot agreement accordingly.

### P1 — must exist for a supportable pilot

1. Add privacy-preserving aggregate measurement for setup completion, activation,
   useful tutoring/value signals, payment state, retention, referrals, and
   support burden; exclude child content and routine transcripts.
2. Add a current launch record showing deployment version, health/readiness
   result, backup/restore result, alert ownership, extension artifact, and real
   acceptance result.
3. Exercise the support and incident runbooks with safe request IDs, including
   suspension/revocation, isolation incident handling, export, and deletion.
4. Reconcile public messaging with the approved offer and actual capability;
   remove any implication that a downloadable artifact or setup guide alone
   proves production readiness.

## Recommended sequencing

The next dependency should be the production-hosted-readiness task, beginning
with route/deployment verification and operational controls. Real-family
onboarding should follow only after those probes are green. The pilot-offer-
payment task can define the offer in parallel, but payment implementation and
any public price should wait for owner approval.

## References

- [`docs/launch-checklist.md`](launch-checklist.md)
- [`docs/operations.md`](operations.md)
- [`docs/onboarding.md`](onboarding.md)
- [`docs/privacy-consent.md`](privacy-consent.md)
- [`docs/support-runbook.md`](support-runbook.md)
- [`e2e.md`](../e2e.md)
- [`docs/promotion-site.md`](promotion-site.md)
