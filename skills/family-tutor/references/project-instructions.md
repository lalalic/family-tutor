# Child Codex thread contract

Each child gets a separate persistent Codex CLI thread. No ChatGPT Project, tab, browser session, or conversation id is configured by Family Tutor.

The Project/parent `AGENTS.md` supplies stable tutoring behavior. The runtime appends only a data-only `<FAMILY_TUTOR_CONTEXT>` envelope whose `type` is `kid` or `parent`; it never appends repeated policy prose or raw provider/channel identifiers. Keep changing facts such as mastery, misconceptions, commitments, deadlines, and interests in the child's durable `AGENTS.md`. Do not put transcripts, Discord ids, secrets, or unrelated runtime state in it.

The runtime may update the child `AGENTS.md` through the `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>` control block and strips that block before sending the visible reply to the child. `<FAMILY_TUTOR_PARENT>` and `<FAMILY_TUTOR_ROLLOVER/>` are likewise hidden runtime controls.

- `type: "kid"` and `type: "parent"` share one inbound data schema: `{ correlationId, senderName, message }`. `correlationId` is the deterministic reply handle for that inbound turn. Reply using `reply_to_discord({ correlationId, text, final? })`; do not infer or select Discord channels.
