# Architecture

Family Tutor has two related but separate runtime surfaces: a shared hosted
commercial service for customer families, and the reusable local tutor runtime
used for development/dogfooding. Customer traffic must not fall back to an
arbitrary local instance.

```mermaid
flowchart LR
  U[Family ChatGPT Project] --> X[Chrome extension]
  X --> M[Hosted MCP /mcp]
  M --> S[(Transactional provisioning store)]
  M --> D[Shared Discord adapter/bot]
  D --> C[Logical child or parent destination]
  C --> DC[Customer Discord server]
  M --> A[Redacted audit + rate-limit hooks]
```

The hosted path authenticates a family session, checks scope and entitlement,
accepts only logical destinations, resolves provider bindings inside trusted
adapters, and records metadata without child content. `/healthz` is liveness;
`/readyz` is dependency readiness; `/mcp` is authenticated application traffic.

The local tutoring path remains useful for the operator and for the existing
family runtime:

```mermaid
flowchart LR
  K1[Kid 1 Discord] --> B[family-tutor-orchestrator / PM2]
  K2[Kid 2 Discord] --> B
  B --> C[Bounded Codex CLI execution]
  C --> T1[Persistent Kid 1 Codex thread]
  C --> T2[Persistent Kid 2 Codex thread]
  T1 --> C
  T2 --> C
  C --> B
  B --> K1
  B --> K2
  T1 --> P[Parent learning telemetry]
  T2 --> P
  P --> PD[Parent Discord]
```

The reusable implementation lives in `skills/family-tutor`; each real local
family instance lives under ignored `runs/family/`. Hosted provisioning state
must use a transactional store for multi-process deployments. The included JSON
store is suitable for one-process rehearsals only.
