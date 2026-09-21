# Privacy and consent contract

This document is the repository-level product contract for the pilot. It is
not legal advice or final terms; the owner and counsel must approve the market,
guardian-consent language, retention schedule, and incident-notification
process before a family is accepted.

## Default visibility

Each child has an independent ChatGPT Project/thread and private Discord
destination. Parents do not normally have access to the child's tutor channel
and are not routinely watching individual messages. The parent destination is
for concise learning telemetry: topic, evidence of understanding, recurring
misconception, progress, missed plan, next step, or when support may help.
Routine child messages, casual conversation, and full transcripts are not
mirrored.

Serious safety concerns are the exception. Escalation contains only the minimum
information needed for a parent or responsible adult to respond. When safe and
appropriate, the child is told that escalation is happening. Neo must never
promise that a child conversation is absolutely secret.

## Data boundaries

The hosted provisioning store may contain family status, logical bindings,
session hashes, expiry/revocation state, and operational metadata. It must
reject transcript-shaped fields. Logs and audit events may contain request IDs,
logical destination keys, tool/outcome, and safe error categories, but not
tokens, provider IDs, child text, transcripts, or request bodies.

The family owns its ChatGPT account and Projects. Learner memory and local
tutor thread state remain in the private runtime boundary under ignored
`runs/family/`; they are not copied into tracked documentation or parent
telemetry by default.

## Family requests and pilot approval

Before onboarding, confirm guardian consent, authorized family ownership of the
Discord server and ChatGPT account, support contacts, retention, deletion/export
procedure, pricing, and the approved safety escalation path. A family may ask
the pilot operator about deletion or export through the approved support
contact; the operator must record only the request status and approved result,
not a transcript copy. The current code does not provide a self-service delete
or export command.

See [`docs/launch-checklist.md`](launch-checklist.md) and
[`docs/support-runbook.md`](support-runbook.md) for operational handling.
