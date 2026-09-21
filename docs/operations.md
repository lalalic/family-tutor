# Operations and deployment

This is the production contract for the shared MCP and Discord services. The
deployment platform owns TLS, process supervision, secret storage, and alerts.

## Configuration

Required at deployment time:

| Setting | Rule |
| --- | --- |
| `HOST` / `PORT` | Platform listener values; use a private bind behind the edge. |
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
- `POST /mcp` is the authenticated application endpoint.

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
