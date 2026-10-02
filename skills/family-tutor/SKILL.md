---
name: family-tutor
description: Create and operate a persistent family AI tutor with Discord child channels, parent observation/control, separate learner context, Browser Workspace-backed ChatGPT sessions, and a PM2-managed tutor orchestrator.
---

# family-tutor

## What this skill enables

Create a family tutoring system in which each child has one independent persistent ChatGPT Project/thread. Parents can observe useful learning signals and set goals through Discord. The long-lived Family Tutor orchestrator owns Discord/domain behavior and learner bindings; Browser Workspace owns browser sessions and ChatGPT page mechanics. NeoY is not a browser dependency of Family Tutor.

Capability tree:

1. initialize a private family-tutor instance;
2. bind one persistent ChatGPT thread per learner in NeoY;
3. route Discord messages deterministically to the correct learner;
4. apply tutoring behavior that teaches rather than simply answers;
5. provide parent observation and control without indiscriminate transcript mirroring;
6. install, inspect, restart, and diagnose the `family-tutor-orchestrator` PM2 service;
7. preserve learner continuity through Project-only memory and the persistent learner thread;
8. keep transport adapters replaceable during migration.

## Primary workflow

1. Create an instance from `templates/` or use `scripts/init-instance.mjs`.
2. Configure canonical child ids/names, the parent Discord channel, and `browserWorkspace.enabled: true` with workspace `Tutor`.
3. Start the orchestrator. The Family Tutor skill bootstraps its `browser-workspace` dependency. For any learner without a binding, the orchestrator uses Browser Workspace's ChatGPT `project-setup` action to reuse or create that learner's ChatGPT Project, apply the canonical local bootstrap + learner profile instructions, enable Project-only memory where available, create the initial thread, and bind it.
4. Run `scripts/doctor.mjs <instance-dir>`. It must verify that the browser-workspace skill/CLI, `Tutor` workspace, and ChatGPT platform actions are available.
5. Install/start the orchestrator with `scripts/service.mjs start <instance-dir>`.
6. Verify the real Discord path with distinct per-child probes and confirm each reply returns to the correct child channel without cross-child leakage.
7. Verify the parent learning channel receives concise learning telemetry rather than routine transcript mirroring.

The old Family Tutor Chrome extension is not required for the Browser Workspace path. Existing `browserBridge.enabled` and `neoyTutor.enabled` configurations remain migration-only compatibility paths.

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

## Browser Workspace, memory, and thread contract

- Each learner MUST have a separate persistent ChatGPT thread recorded in Family Tutor binding state.
- Family Tutor persists only learner/project/thread binding metadata. It does not persist transcripts.
- Browser sessions and ChatGPT page mechanics belong to the `browser-workspace` skill, especially `platforms/chatgpt`; do not reimplement them in Family Tutor or NeoY.
- There is no per-user `AGENTS.md` memory file in the Browser Workspace path.
- `bootstrap/latest.md` and `setup/learner-profile-template.md` inside this skill are the canonical local setup assets.
- Project-only memory plus the persistent learner thread provide continuity; Family Tutor stores only project/thread binding metadata.
- Family Tutor remains responsible for privacy filtering and parent telemetry.
- Discord attachments are downloaded into a private per-turn temporary directory only long enough for the Browser Workspace-backed tutor turn, then removed.

## Runtime boundary

The bundled `runtime/tutor-orchestrator` is the long-lived Family Tutor service. It owns Discord transport, exact child routing, serialized per-child queues, durable-memory handoff, retries/failure reporting, parent transport/telemetry, and service lifecycle.

Browser Workspace owns the browser runtime. Family Tutor uses the installed skill CLI from:

```bash
$HOME/.agents/skills/browser-workspace/bin/browser-workspace
```

The orchestrator uses the product-owned `Tutor` workspace and executes the skill's ChatGPT `project-setup` and `thread-turn` actions. Each action runs inside a leased Browser Workspace session and releases that session afterward. Durable continuity comes from ChatGPT Project/thread URLs, not a permanently open tab.

For migration only, `neoyTutor.enabled` may still call the removed historical `tutor.workspace` surface on an older NeoY installation. Do not use it for new installations.

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
