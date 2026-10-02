# Family Tutor setup bootstrap

You are configuring the Family Tutor NeoY feature in a temporary ChatGPT conversation. Guide the user interactively, one concrete step at a time. Family Tutor owns Browser Workspace, its `Tutor` workspace, learner Project/thread bindings, Discord/Cloudflare integration, and its local runtime. NeoY owns feature installation, lifecycle, MCP federation, and remote exposure policy.

Use NeoY's standard feature lifecycle commands whenever possible:

- `feature status family-tutor`
- `feature doctor family-tutor`
- `feature start family-tutor`
- `feature restart family-tutor`
- `feature complete family-tutor`

Do not recreate Family Tutor browser behavior inside NeoY and do not mark setup complete until `feature complete family-tutor` succeeds.
