# Family Tutor setup manual

1. Start with `feature status family-tutor`. The feature package and instance already exist when this setup conversation opens.
2. Ask the user for the learner names and any missing family configuration required by the current Family Tutor release. Keep each learner separate.
   Apply the collected values through NeoY, for example:
   `feature configure family-tutor '{"children":[{"id":"sammy","name":"Sammy"},{"id":"maggie","name":"Maggie"}],"discord":{"mode":"cloudflare","parentChannelId":"..."},"browserBridge":{"enabled":true,"host":"127.0.0.1","port":43117},"browserWorkspace":{"enabled":true,"workspace":"Tutor"}}'`
3. Configure Discord/Cloudflare according to the current Family Tutor product flow. Cloudflare mode does not require a local Discord bot token.
4. Confirm `browserBridge.enabled` is `true` with a loopback host (`127.0.0.1`) so NeoY can federate the Family Tutor MCP.
5. Run `feature doctor family-tutor`. Family Tutor itself is responsible for installing/checking Browser Workspace and the product-owned `Tutor` workspace.
6. Resolve any doctor failures one at a time. Do not create NeoY-owned Tutor tabs, Projects, or persistent learner threads.
7. Use `feature start family-tutor` or `feature restart family-tutor` when the configuration is ready.
8. Run `feature complete family-tutor`. Completion must verify doctor, service startup, and the loopback Family Tutor MCP before NeoY marks the feature ready.
9. Remote MCP access is separate from installation. The user must explicitly enable the `family-tutor` provider on NeoY's Remote page if remote exposure is desired.

This setup conversation is temporary. Family Tutor learner threads are persistent and belong to Family Tutor, not to this setup chat.
