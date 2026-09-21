# Family Tutor E2E verification

The hosted product release gate has two layers: `npm run check:product` runs the
canonical synthetic two-family flow through the product composition, and the
real Discord path runs through the single PM2-resident
`family-tutor-orchestrator`. Neither a service status check nor a direct Codex
probe is sufficient by itself.

## Preconditions

- The instance has `codex.backend: codex`, child Discord channel ids, and a parent channel id.
- The host has an authenticated `codex` CLI and a Discord bot token.
- Each child has a distinct child channel and durable `AGENTS.md` under the ignored instance directory.

## Critical checks

1. Send distinct probe messages to each child channel close together. Verify each reply returns to its originating channel and that one slow child does not block the other.
2. Confirm the child context is isolated: each child receives only its own durable memory and its own persistent Codex thread.
3. Exercise voice and image messages. Verify local transcription and image attachment handling, with a useful error if either fails.
4. Use `!goal`, `!focus`, and `!ask` from the configured parent channel. Verify the command targets exactly the named child and the parent receives concise learning telemetry rather than a raw transcript.
5. Have a tutor response emit a complete `<FAMILY_TUTOR_MEMORY>` block and `<FAMILY_TUTOR_ROLLOVER/>`. Verify memory is written before `.codex-thread.json` is removed and that the next turn creates a fresh thread.
6. Inspect the instance: no transcript files or browser/project/tab bindings are created.

## Evidence

Capture Discord message ids/channels, service logs, the child `AGENTS.md` diff, and the thread-state transition in the ignored run directory. Do not commit those artifacts or any credentials.
