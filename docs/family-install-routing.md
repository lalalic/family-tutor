# Family installation and routing

Family Tutor uses **one hosted Discord bot and MCP service for many families**. There is no parent/router agent. The only intelligent agents are each child's persistent ChatGPT thread.

## Identity

- `guildId` is the Discord family/tenant identity.
- A family installation credential authenticates the extension/MCP to that guild. It is random, never derived from `guildId`; the server stores only its hash.
- `guildId + childId` identifies a child destination within a family.
- `correlationId` is temporary reply plumbing for one inbound Discord event. It is **not** family context or identity.
- The Tutor Server owns Discord destination bindings. The extension owns `childId -> active ChatGPT thread` bindings.

## Installation

```mermaid
sequenceDiagram
    actor Parent
    participant Site as Family Tutor Site
    participant Discord
    participant Server as Tutor Server
    participant Ext as Browser Extension
    participant ChatGPT

    Parent->>Site: Add to Discord
    Site->>Discord: OAuth bot install
    Parent->>Discord: Choose family server and authorize
    Discord->>Server: OAuth callback with guildId
    Server->>Server: Create installation for guildId
    Server-->>Site: Short-lived claim
    Site->>Ext: Connect installation
    Ext->>Server: Redeem claim
    Server-->>Ext: Scoped family credential
    Parent->>ChatGPT: Connect Family Tutor MCP
    ChatGPT->>Server: Authenticate same family installation
```

The customer never types or sees a guild ID or long-lived family credential.

## Runtime topology

```mermaid
flowchart TB
    Bot["One Discord Bot"] --> Server["Tutor Server<br/>deterministic routing only"]
    Server --> A["Guild A"]
    Server --> B["Guild B"]
    A --> AP["parent channel"]
    A --> AS["sammy channel"]
    A --> AM["maggie channel"]
    B --> BS["sammy channel"]
    Server <--> EA["Family A extension"]
    Server <--> EB["Family B extension"]
    EA --> AST["A / Sammy thread"]
    EA --> AMT["A / Maggie thread"]
    EB --> BST["B / Sammy thread"]
```

A child name is never globally unique. `Guild A + sammy` and `Guild B + sammy` are isolated routes.

## Parent multi-child message

For `ask #sammy to do homework, and #maggie to draw poster`, the server performs only configured `#name` matching. It does **not** interpret or split the natural-language instruction.

```mermaid
sequenceDiagram
    participant P as Parent Discord
    participant S as Tutor Server
    participant E as Family Extension
    participant ST as Sammy thread
    participant MT as Maggie thread
    participant MCP as Family Tutor MCP
    participant SD as Sammy Discord
    participant MD as Maggie Discord

    P->>S: original parent message
    Note over S: Resolve guild from inbound channel<br/>match #sammy and #maggie mechanically
    S->>E: childId=sammy + unchanged message
    S->>E: childId=maggie + unchanged message
    E->>ST: parent context for sammy
    E->>MT: parent context for maggie
    Note over ST: Existing kid agent decides what applies to Sammy
    Note over MT: Existing kid agent decides what applies to Maggie
    ST->>MCP: send to child sammy
    MT->>MCP: send to child maggie
    MCP->>S: authenticated family + logical child
    S->>SD: resolve guild + sammy
    S->>MD: resolve guild + maggie
```

## Context versus delivery

`FAMILY_TUTOR_CONTEXT` contains semantic data only:

```json
{"type":"parent","data":{"childId":"sammy","parentMessage":"ask #sammy to do homework, and #maggie to draw poster"}}
```

The same unchanged parent message is delivered to every explicitly mentioned child's thread. Each thread interprets only its own part.

```text
correlationId -> exact inbound Discord event -> reply to source
guildId + childId -> configured child Discord channel -> send to child
childId -> extension activeThreadId -> deliver to ChatGPT
```

This keeps the backend deterministic: **one intelligent agent per child; transport does not become another agent.**
