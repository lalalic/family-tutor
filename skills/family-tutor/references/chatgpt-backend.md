# Codex CLI backend

Family Tutor uses the locally authenticated `codex` CLI. It does not use DevMacBridge, Chrome, ChatGPT tabs, ChatGPT Projects, or browser automation.

Each child has an isolated Codex thread. The runtime stores only `.codex-thread.json` below that child's ignored instance directory and resumes it with `codex exec resume`. Legacy Codex mode may still use its historical local memory file. The NeoY Tutor path does not; it uses Project-only memory and the persistent ChatGPT thread.

Images are downloaded into a temporary directory and passed to Codex with `--image`; temporary files are removed after the turn. Voice messages are transcribed locally before the tutor turn.

When the tutor emits `<FAMILY_TUTOR_MEMORY>...</FAMILY_TUTOR_MEMORY>` and `<FAMILY_TUTOR_ROLLOVER/>`, the runtime writes the complete durable memory first, removes the child thread binding, and the next turn starts a new Codex thread. Rollover is never based on an arbitrary turn count.
