# Tenant routing contract

The hosted Discord bot and MCP service must authenticate a family before they
resolve a destination. Models and tools address a logical target:

```json
{ "familyId": "family-a", "childId": "alex" }
```

They must not choose an arbitrary raw Discord channel id. Provider ids are
stored only in an operator-managed binding and are resolved by the trusted
family route index (`packages/core`). A binding has:

- a stable `familyId`;
- a logical destination key (`parent` or a child key);
- the provider id used to deliver the message; and
- for child routes, the stable `childId`.

Every request path must carry the authenticated `familyId`, then resolve the
logical destination inside that family. Unknown destinations, duplicate family
or child ids, and duplicate destination keys are hard errors. Never fall back
to a global provider-id lookup.

This is a foundation contract, not a complete identity system. Follow-up work
must add signed/session-backed family authentication, persistent provisioning
state, audit events, rate limits, and integration tests through the Discord and
MCP adapters.
