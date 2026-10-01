---
name: family-tutor
description: Create and operate a persistent family AI tutor through NeoY Tutor Workspace with Discord child channels, parent observation/control, separate learner context, and a PM2-managed tutor orchestrator.
---

# family-tutor

## What this skill enables

Create a family tutoring system in which each child has one independent persistent tutor context and one local durable `AGENTS.md`. Parents can observe useful learning signals and set goals through Discord. The long-lived Family Tutor orchestrator owns Discord/domain behavior; NeoY owns the fixed browser-backed ChatGPT Tutor Workspace.

Capability tree:

1. initialize a private family-tutor instance;
2. bind one persistent ChatGPT thread per learner in NeoY;
3. route Discord messages deterministically to the correct learner;
4. apply tutoring behavior that teaches rather than simply answers;
5. provide parent observation and control without indiscriminate transcript mirroring;
6. install, inspect, restart, and diagnose the `family-tutor-orchestrator` PM2 service;
7. preserve learner continuity through local `AGENTS.md`;
8. keep transport adapters replaceable during migration.

## Primary workflow

1. Create an instance from `templates/` or use `scripts/init-instance.mjs`.
2. Configure canonical child ids/names, the parent Discord channel, and `neoyTutor.enabled: true`.
3. In NeoY **Setup → Tutor**, bind each learner id to that learner's existing ChatGPT thread.
4. Run `scripts/doctor.mjs <instance-dir>`. For the NeoY path it must verify that the local NeoY MCP exposes `tutor.workspace`.
5. Install/start the orchestrator with `scripts/service.mjs start <instance-dir>`.
6. Verify the real Discord path with distinct per-child probes and confirm each reply returns to the correct child channel without cross-child leakage.
7. Verify the parent learning channel receives concise learning telemetry rather than routine transcript mirroring.

The Family Tutor Chrome extension is not required for the NeoY path. Existing `browserBridge.enabled` configurations remain a temporary legacy fallback only.

## Tutor behavior contract

Read `references/tutoring-behavior.md` when creating or repairing tutor behavior.

- Teach before giving the final answer when pedagogically useful.
- Diagnose existing understanding and prefer hints or guided questions.
- Ask one focused question at a time when interactive teaching is appropriate.
- Use age/grade-appropriate language.
- Verify understanding with demonstrated evidence rather than accepting “I understand” as mastery.
- Keep each child's context separate.

## Parent observation contract

Read `references/parent-observation.md` when configuring the parent channel or reports. Default parent output is learning telemetry: topic, evidence, misconception, progress, next step, and tutor note. Do not mirror every child message into the parent channel by default.

## NeoY, memory, and thread contract

- Each learner MUST have a separate persistent ChatGPT thread bound in NeoY Tutor Workspace.
- NeoY persists only learner/thread/browser-target binding state. It does not persist transcripts.
- ChatGPT page mechanics belong to `browser-platforms/platforms/chatgpt`, not to Family Tutor or NeoY Swift.
- Local durable learner context lives at `<instance-dir>/<child-id>/AGENTS.md`.
- The tutor may replace learner memory by emitting `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>`; the orchestrator strips the block and atomically writes the replacement.
- Family Tutor remains responsible for privacy filtering and parent telemetry.
- Discord attachments are downloaded into a private per-turn temporary directory only long enough for the NeoY synchronous turn, then removed.

## Runtime boundary

The bundled `runtime/tutor-orchestrator` is the long-lived Family Tutor service. It owns Discord transport, exact child routing, serialized per-child queues, durable-memory handoff, retries/failure reporting, parent transport/telemetry, and service lifecycle.

NeoY owns persistent ChatGPT workspace lifecycle through one fixed MCP tool:

```text
tutor.workspace
  status
  bind
  unbind
  turn
```

The orchestrator calls that tool over the local loopback MCP endpoint. It does not automate Chrome itself.

For migration only, an explicitly enabled legacy `browserBridge` may still use the old Chrome extension path when NeoY transport is not enabled. Do not use the extension for new NeoY-backed instances.

## Service lifecycle

Use the existing `daemon-service-manage` conventions:

```bash
node scripts/service.mjs status <instance-dir>
node scripts/service.mjs start <instance-dir>
node scripts/service.mjs restart <instance-dir>
node scripts/service.mjs logs <instance-dir>
node scripts/service.mjs stop <instance-dir>
```

## Safety and privacy

- Never commit Discord tokens, browser credentials, child transcripts, or runtime state.
- A child channel must map to exactly one child.
- A tutor thread must map to exactly one child.
- Parent control commands must come only from the configured parent control channel.
- Treat child personal data as private runtime data.
