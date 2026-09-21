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

## Provisioning and session storage

`@family-tutor/core` exports `createProvisioningStore`. Give it a JSON
`filePath` for a small local persistent store, or omit the path for tests. The
store writes schema version 1 records atomically and creates the parent and
child bindings used by the route index. A binding stores only the provider
destination needed by the adapter; model-facing callers still use logical
family/destination keys.

Sessions are bearer credentials returned once by `createSession`. Only a
SHA-256 token hash, family id, scopes, timestamps, and revocation state are
persisted. Callers must authenticate the session before resolving a route, and
the authenticated family is always compared with the requested family. Session
tokens should be delivered over an encrypted transport and never logged.

The storage boundary rejects transcript-shaped fields (`messages`, `content`,
`history`, and `transcript`) and has no API for storing child turns. Learner
memory and tutor thread state remain in the private family runtime; provider
adapters own delivery and audit concerns.

Migration assumption: schema version 1 is an initial deployment format, not a
general migration engine. A future incompatible format must add an explicit
migration before changing `schemaVersion`; do not silently reinterpret an
existing file. The atomic replacement write is suitable for one local process;
multi-process or hosted deployments should put the same contract behind a
transactional database adapter.
