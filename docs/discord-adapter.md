# Discord adapter boundary

`packages/discord-adapter` is the shared multi-family transport boundary. It is
independent of `discord.js`; the host supplies a provider with
`send({ channelId, content, metadata })`.

The trusted adapter API accepts an authenticated session token and a logical
child target such as `{ familyId, childId }`, or the fixed parent target
`{ familyId, destinationType: 'parent', destinationKey: 'parent' }`. These
`familyId` fields are server-side context derived from the session; they are not
model-facing tenant selectors. The adapter authenticates the session, checks
family and scope, resolves the provider binding through `@family-tutor/core`,
and then calls the provider. Hosted MCP callers use the narrower
`{ destination: { type, key } }` shape documented in
[`hosted-mcp-adapter.md`](hosted-mcp-adapter.md).

Raw Discord IDs are accepted only for trusted ingress via `receive()` and for
the final provider call. `audit` receives metadata only, and `rateLimit` runs
after authorization and before delivery. Provider failures become safe
`DiscordAdapterError` values; audit failures do not break delivery.

## Hosted ingress

The commercial product uses `receiveTrusted({providerChannelId})` only inside the trusted shared-bot ingress. It scans active provisioning bindings and succeeds only when the provider channel maps to exactly one logical family/destination. The provider id is discarded before the turn enters the extension/ChatGPT path. This method is not model-facing and must never be exposed as an MCP argument.
