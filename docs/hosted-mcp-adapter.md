# Hosted MCP adapter

`@family-tutor/hosted-mcp-adapter` is the hosted boundary for shared Family
Tutor tools. It is intentionally small and provider-neutral: a bearer session
created by `@family-tutor/core` establishes the family identity, and tool
arguments can contain only logical destinations such as `{ "type": "child",
"key": "alex" }`.

## Configuration

Construct the adapter with the provisioning store and explicit handlers:

```js
const adapter = createHostedMcpAdapter({
  store,
  entitlements: { "family-a": ["premium"] },
  handlers: {
    send_tutor_message: ({ familyId, destination, arguments: args }) =>
      deliver({ familyId, providerId: destination.providerId, text: args.text }),
  },
  audit: event => auditSink.write(event),
  rateLimiter: ({ familyId, tool }) => limiter.check(`${familyId}:${tool}`),
});
const server = createHostedMcpServer({ adapter, host: process.env.HOST || "127.0.0.1", port: Number(process.env.PORT || 8080) });
await server.start();
```

Keep sessions and provider bindings in a transactional store for multi-process
deployments. Pass secrets through the platform secret manager; never put bearer
tokens, Discord IDs, child messages, or provider credentials in source,
configuration committed to this repository, logs, audit payloads, or relay
events. Use TLS at the edge and forward only the `Authorization: Bearer ...`
header to `/mcp`.

## Security boundaries

- The authenticated session is the only tenant selector. `familyId`, `tenantId`,
  provider IDs, and raw channel IDs in tool arguments are rejected.
- Destinations are resolved through the authenticated family’s provisioning
  store before a handler receives a provider binding.
- Core tools are available to authenticated `tutor` sessions. Premium tools
  are hidden and rejected unless the family has an explicit entitlement.
- Rate limiting runs after authentication and before destination resolution or
  handler execution, allowing a deployment to enforce family/tool quotas.
- Audit callbacks receive a redacted event with request ID, family, logical
  destination, tool, outcome, and rejection reason; they never receive tokens,
  message text, or provider IDs.

The adapter does not persist transcripts. Learner memory and tutor thread state
remain in the private family runtime.

## Correlated Discord replies

When the hosted product configures the extension relay, MCP discovery also exposes `reply_to_discord(correlationId, text, final?)`. The correlation is opaque and server-issued. The handler verifies the authenticated family (and child-scoped session when applicable) owns that correlation before replying to the trusted originating Discord channel. The tool never accepts a channel id, family id, or provider id.
