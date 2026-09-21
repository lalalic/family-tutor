# Tutor MCP research notes

Status: reference architecture only; do not integrate into the live family tutor yet.

The family tutor should evolve from real use with children. Run the current tutor for a while, observe where it helps or fails, then add only the capabilities that solve observed problems.

## Reference project

- Project: `ArnaudGuiovanna/tutor-mcp`
- Purpose: adaptive-learning runtime for an LLM tutor.
- Local experiment copy: keep under ignored `runs/`; never vendor the repository into Neo source.
- Experimented locally on 2026-09-16 with the SQLite/development profile. It built and started successfully; `/live` and `/ready` passed, and `go test ./tools` passed.

## Concepts worth keeping

### Separate the tutor voice from deterministic learning state

The LLM should own explanation, questioning, examples, encouragement, and natural conversation. A deterministic runtime can own durable learner state and decisions that should not depend entirely on conversational memory.

Useful state includes:

- concepts and prerequisites;
- demonstrated mastery and uncertainty;
- review timing;
- recurring misconceptions;
- recent learning sessions;
- affect/motivation observations when genuinely useful;
- explicit learner commitments / implementation intentions.

### Activity selection

Tutor MCP centers the learning loop around `get_next_activity` and `record_interaction` rather than letting the LLM improvise the whole learning sequence. This is a useful pattern for Family Tutor: the persistent Codex thread can remain the child-facing tutor while a small state layer recommends the next useful study action.

### Commitments are especially relevant to Family Tutor

Tutor MCP persists implementation intentions and can later mark them completed or otherwise resolved. Family Tutor should eventually support the same idea in simpler child-friendly language, for example:

> "After dinner I will do four chemistry questions."

This is more useful for proactive study coaching than generic timed reminders because follow-up is connected to something the learner actually agreed to do.

### Proactive intervention, not notification spam

Tutor MCP has a scheduler and a queued webhook/nudge model. Its useful architectural lesson is that proactive contact should be based on learner state, review need, an open loop, or a commitment—not merely a timer firing.

Potential Family Tutor action vocabulary later:

- do nothing;
- suggest next study task;
- check a learner commitment;
- offer a short review;
- reconnect to unfinished work;
- adjust a study plan;
- notify the parent only when parent involvement is useful.

### Preserve an auditable reason for interventions

A proactive message should have a compact internal reason such as `why_now`, `learning_gain`, `open_loop`, and `next_action`. The child should receive natural language, not internal metrics or tool terminology.

## Family Tutor architecture direction

Do not replace the current persistent per-child Codex tutor with Tutor MCP. If these concepts prove useful in real family use, the likely shape is:

```text
Discord / future channels
        |
        v
tutor-orchestrator
        |
        +--> persistent Codex tutor thread (child-facing intelligence)
        |
        +--> learner/study state (small deterministic layer)
        |
        +--> proactive study-coach loop
                 |
                 +--> decide whether intervention is useful
                 +--> wake the existing tutor to phrase/handle it
```

Start much smaller than Tutor MCP. Family Tutor is for real children and schoolwork, not a general adaptive-learning SaaS, so copy concepts rather than infrastructure.

## Agent placement decision

If active study coaching eventually needs a distinct agent/role prompt, it belongs inside `skills/family-tutor/` because it is reusable tutoring behavior. It should not be a project-specific agent under `family-tutor/agents/` and should not be made a global agent unless it later becomes genuinely cross-domain.

Prefer keeping one persistent child tutor as the conversational brain. A separate "study coach agent" is warranted only if real usage demonstrates that a separate role/lifecycle provides a clear advantage over waking the same tutor with structured learner state.

## Adoption rule

Do not implement the Tutor MCP-inspired layer speculatively. First collect real usage from the children, then use these notes to decide what smallest capability addresses the observed need.
