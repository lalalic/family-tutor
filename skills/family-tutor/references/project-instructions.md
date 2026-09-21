# Child Codex thread contract

Each child gets a separate persistent Codex CLI thread. No ChatGPT Project, tab, browser session, or conversation id is configured by Family Tutor.

The runtime supplies shared tutoring behavior, child identity, and the child's durable `AGENTS.md` on every turn. Keep changing facts such as mastery, misconceptions, commitments, deadlines, and interests in that file. Do not put transcripts, Discord ids, secrets, or unrelated runtime state in it.

The runtime may update the child `AGENTS.md` through the `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>` control block and strips that block before sending the visible reply to the child. `<FAMILY_TUTOR_PARENT>` and `<FAMILY_TUTOR_ROLLOVER/>` are likewise hidden runtime controls.
