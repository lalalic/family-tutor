# Family Tutor end-to-end verification

The commercial release gate validates the same hosted product composition used
in production. Local service status or isolated package tests are not enough.

## Automated product gate

Run:

```bash
npm run check:product
```

The synthetic gate provisions two families with overlapping logical child
names, starts the hosted process, authenticates two extension WebSocket
sessions, completes Project/onboarding readiness, and verifies the full turn:

```text
trusted Discord ingress
  -> exact family/child extension socket
  -> ChatGPT Project turn payload
  -> hosted MCP reply_to_discord
  -> exact originating Discord channel
```

It also verifies logical MCP outbound delivery, cross-family rejection, raw
provider-id rejection, export redaction, session revocation, deletion isolation,
and content-free health/readiness endpoints.

## Real pilot acceptance

Before enabling a real family:

1. Provision the family and each private child destination through the trusted
   operator/onboarding path.
2. Connect ChatGPT Developer Mode to the hosted `/mcp` endpoint with the scoped
   family session.
3. Configure extension 2.3.0 or newer with
   `wss://family-tutor.qili2.com/extension` and the family session token.
4. Bind each child to a distinct ChatGPT Project/thread and confirm extension
   health shows every expected child connected.
5. Send distinct Discord probe messages to two child channels close together.
   Verify each turn appears only in its assigned Project and each MCP reply
   returns to the exact originating Discord channel/message.
6. Attempt a wrong-family correlation reply and a raw-provider MCP target; both
   must be rejected without provider identifiers in the response/logs.
7. Confirm the parent destination receives only approved concise learning
   telemetry, not routine child transcript mirroring.
8. Exercise export and dry-run deletion with an operator-scoped session, then
   confirm the export contains logical metadata only.
9. Verify `GET /healthz` and `GET /readyz` are healthy and that logs contain no
   child content, bearer tokens, provider ids, or transcript bodies.

Capture only message ids, logical family/child ids, request/correlation ids,
release versions, and pass/fail evidence. Never commit credentials or learner
content.

## Local dogfood compatibility

The existing PM2/local tutor runtime can still be tested with its local Discord
and loopback bridge workflow. That test is useful for regression coverage but is
not evidence that the hosted commercial path works for an external family.
