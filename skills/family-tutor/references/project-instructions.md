# Child Codex thread contract

Each child gets a separate persistent Codex CLI thread. No ChatGPT Project, tab, browser session, or conversation id is configured by Family Tutor.

For the NeoY Tutor path, stable tutoring behavior comes from the skill-local bootstrap plus learner profile template applied as ChatGPT Project Instructions. The runtime appends only a data-only `<FAMILY_TUTOR_CONTEXT>` envelope whose `type` is `kid` or `parent`; it does not maintain a learner `AGENTS.md`.

`<FAMILY_TUTOR_PARENT>` and `<FAMILY_TUTOR_ROLLOVER/>` remain hidden runtime controls. Learner continuity is handled by ChatGPT Project-only memory and the persistent thread.

- `type: "kid"` and `type: "parent"` share one inbound data schema: `{ correlationId, senderName, message }`. `correlationId` replies to the inbound sender. A parent message may contain routable mentions such as `@sammy(channelId=ch_...)`; use that channelId only when the parent asks you to send something to that named child. `reply_to_discord` accepts exactly one of `correlationId` or `channelId`.

- Browser-backed ChatGPT Projects must treat visible assistant text as non-delivery. Every `<FAMILY_TUTOR_CONTEXT>` requires a final `reply_to_discord({ correlationId: data.correlationId, text, final: true })` call. A `<FAMILY_TUTOR_DELIVERY_REMINDER>` is a bounded recovery signal to deliver the already-completed answer, not to recompute it.
