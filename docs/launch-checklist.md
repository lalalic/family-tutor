# Family Tutor pilot launch checklist

## Before accepting a family

- [ ] Owner has approved pilot scope, pricing, refund/credit policy, and
      support hours.
- [ ] Privacy notice, consent/guardian language, terms, and retention schedule
      have been reviewed for the target market.
- [ ] Family owner identity and authorized Discord/ChatGPT access are verified.
- [ ] Each child has a separate logical destination and private channel.
- [ ] Parent access is limited to the parent channel and learning telemetry.
- [ ] Delete/export request path and incident contact are explained.

## Technical readiness

- [ ] Provisioning uses a transactional store for multi-process deployment.
- [ ] TLS and a platform secret manager are configured; tokens are not in logs,
      source, committed config, or support notes.
- [ ] Sessions have scopes, expiry, and revocation; family suspension works.
- [ ] Discord and MCP callers use logical destinations only.
- [ ] Audit output is redacted and rate limits are active.
- [ ] Premium entitlements are explicit and conservative.
- [ ] Health checks, backups, restore rehearsal, alert ownership, and CI are
      verified for the target deployment.

## Customer acceptance test

- [ ] Parent can send/receive a parent-channel test.
- [ ] Each child can send/receive a distinct child-channel test.
- [ ] Replies return to the same logical child destination.
- [ ] A child session cannot access the parent or another child.
- [ ] A family session cannot access another family.
- [ ] Raw provider/channel IDs in tool input are rejected.
- [ ] An expired/revoked session is rejected safely.
- [ ] A rate-limited request is rejected without handler execution.
- [ ] Parent receives concise telemetry, not a transcript mirror.
- [ ] The family knows how to report a safety concern and request deletion/export.

## Go/no-go review

Go only when all acceptance checks pass, the owner has signed off on legal and
business decisions, and the support operator can execute the runbook. A failed
isolation, privacy, authentication, or safety test is an immediate no-go.

## Post-launch weekly review

Review setup time, support incidents, acceptance failures, useful learning
signals, trust scores, retention, referrals, safety escalations, and
delete/export requests. Keep child content out of the metrics report.
