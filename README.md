# Family Tutor

Family Tutor is the Neo monorepo project surface for a parent-visible Discord tutoring workflow. Reusable tutoring/runtime behavior lives in `../skills/family-tutor/`; this project contains public project documentation and architecture only.

The commercial foundation is provider-neutral: shared services must authenticate
a family, resolve logical child/parent destinations, and only then touch provider
IDs. See [`docs/tenant-routing.md`](docs/tenant-routing.md) and the
dependency-free [`@family-tutor/core`](packages/core/) route index. Run `npm ci`
in each runtime package, then `npm run check` at the repository root.

The reusable Discord boundary is [`@family-tutor/discord-adapter`](packages/discord-adapter/).
It accepts authenticated logical targets, resolves provider IDs through core,
and injects provider, audit, and rate-limit hooks. Model/tool callers must never
supply a raw channel ID.

The customer-facing Chrome adapter is documented in [`docs/extension.md`](docs/extension.md).

## Create a private/local instance

All real family configuration, learner details, Discord identifiers, and durable learner memory belong under an ignored run directory:

```bash
node ../skills/family-tutor/scripts/init-instance.mjs runs/family
# edit runs/family/config/family.config.json
node ../skills/family-tutor/scripts/doctor.mjs runs/family
node ../skills/family-tutor/scripts/service.mjs start runs/family
```

Never place real family configuration in tracked project paths. `runs/` is the execution boundary for this public monorepo project.

Each learner keeps one durable `runs/family/<child-id>/AGENTS.md`. Codex owns thread history; Family Tutor stores only the current Codex thread id in the ignored child runtime directory and never persists transcripts.
