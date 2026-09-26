# Operations and deployment

This is the production contract for the shared MCP and Discord services. The
deployment platform owns TLS, process supervision, secret storage, and alerts.

The explicit activation gate is documented in
[`hosted-activation.md`](hosted-activation.md). It separates safe public
probes from owner-controlled deployment, authorization, and real Discord
acceptance; passing `npm run check` alone is not a hosted activation claim.

## Configuration

Required at deployment time:

| Setting | Rule |
| --- | --- |
| `HOST` / `PORT` | Listener for `/mcp`, `/extension`, `/healthz`, and `/readyz`; use a private bind behind the edge. |
| `FAMILY_TUTOR_PROVIDER_MODULE` | Trusted shared-Discord provider module. It must expose `send()` and may expose `start({onMessage})` and `close()`. |
| provisioning store | Use a transactional database adapter for multi-process deployments. The JSON store is for one process and rehearsals. |
| provider credentials | Inject from the platform secret manager at runtime. |
| TLS/edge auth | Terminate TLS at the edge and forward only `Authorization: Bearer ...` to `/mcp`. |

Never commit real values, put tokens in URLs, or log authorization headers,
provider IDs, child content, transcripts, or request bodies. `.env.example`
contains placeholder names only.

The hosted server exposes data-free operational endpoints:

- `GET /healthz` is liveness and returns 200 while the process can serve.
- `GET /readyz` runs the deployment's readiness check and returns 503 when a
  dependency is unavailable.
- `POST /mcp` is the authenticated ChatGPT tool endpoint.
- `GET/upgrade /ws` is the authenticated extension WebSocket endpoint. The
  extension sends its family session token after socket establishment; tokens
  must not be placed in URLs. `/extension` remains a compatibility alias for
  already-installed pilot builds and should not be used in new configuration.

## State, migrations, and recovery

The provisioning store contains family status, logical bindings, session hashes,
expiry, and revocation state. It rejects transcript-shaped fields. Schema
version 1 is not a migration engine: incompatible changes require an explicit
migration and restore rehearsal before rollout.

The core store provides authenticated, scope-gated `exportFamily`/`exportChild`
and `deleteFamily`/`deleteChild` operations for operator workflows. Export is a
redacted record: it includes logical keys and session metadata, never provider
identifiers or token hashes. Deletion supports a dry run and requires exact
family/child confirmation. It removes only Family Tutor state (bindings and
sessions); it does not mutate ChatGPT, Discord, private learner runtime, or
externally retained audit data. Follow the confirmation and recording procedure
in [`support-runbook.md`](support-runbook.md).

Schedule `purgeExpiredSessions({ retentionMs })` for the provisioning store as
part of the deployment's retention job. Set `retentionMs` to the approved
post-expiry operational window, record only the count and run status, and do
not put session tokens or child content in the job log. This cleanup is
separate from external audit retention, which still requires an owner-approved
schedule and deletion procedure.

For the JSON store, stop writes, copy the state file with permissions preserved,
and verify the copy parses before starting a replacement process. Use encrypted
database snapshots for hosted deployments. Rehearse restoration before the
pilot and monthly thereafter; record only the result, timestamp, schema version,
and operator. Never restore over a live instance or delete the current family
state during a rollout.

## Logging and monitoring

Structured logs may contain timestamp, service, deployment version, request ID,
logical destination type/key, outcome, and a safe error category. Adapter audit
hooks receive redacted metadata only. Audit-sink failures must not expose
details to callers or stop delivery, but should increment an operator metric.

Alert on readiness failures, 5xx/rejection spikes, authentication failures,
rate-limit spikes, provider delivery failures, audit-sink failures,
backup/restore failures, and isolation-test failures. Never use child text as a
metric.

## Incident response

For suspected cross-family, cross-child, credential, or safety incidents:

1. Page the operator and record an incident ID.
2. Suspend the affected family and revoke its sessions.
3. Disable the affected handler/service if the blast radius is uncertain.
4. Preserve redacted request IDs and audit metadata, never message content.
5. Run the synthetic two-family/two-child isolation suite and approved real
   acceptance checks.
6. Deploy a reviewed fix and re-run readiness and acceptance checks before
   re-enabling traffic.

Customer/legal notification, credits, and retention exceptions require owner
and counsel approval; the service does not decide them automatically.

## Release and blockers

CI runs `npm run check` and `git diff --check` on every pull request. Deploy a
reviewed commit only after those checks pass, then verify health, readiness,
authenticated MCP discovery, and the real Discord acceptance path. Roll back to
the last verified artifact if isolation, privacy, authentication, or safety
checks fail.

Live-launch blockers requiring owner credentials or approval are production
secret-manager access, provider credentials, TLS/DNS ownership, on-call
ownership, and legal/privacy approval. This repository does not fabricate or
bypass them.
