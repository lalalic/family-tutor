# ChatGPT browser bridge: extension + MCP contract

Family Tutor keeps Discord transport, privacy enforcement, correlation, and exact-origin replies on the local server. The Chrome extension owns only ChatGPT Project assignment and composer mechanics.

## Repository layout

- `skills/family-tutor/extension/` — unpacked Chrome extension.
- `skills/family-tutor/mcp-server/` — loopback browser bridge and MCP stdio adapter.
- `skills/family-tutor/runtime/tutor-orchestrator/` — Discord/Codex tutor runtime; when browser mode is enabled it imports the bridge from `mcp-server`.

## Extension configuration

The extension stores only the user choice `childId -> ChatGPT Project ID`. It does not expose or persist a bridge token, local port, or tab id in its UI. The selected ChatGPT Project thread tab is moved into a dedicated Chrome tab group named `family-tutor`; the group contains exactly one managed tab per child, and browser turns are sent only to tabs in that group. On Chrome startup the extension reconstructs the group from the persisted bindings, reusing a matching Project tab when available and opening the Project only when necessary. Open a ChatGPT Project, open the extension popup, and assign that Project to a child. Project assignments survive tab and conversation changes because they use the stable `g-p-...` Project id.

The extension connects to the fixed loopback browser bridge as implementation plumbing. On an incoming child turn it resolves an open tab for the assigned Project (or opens the Project), uploads transient image attachments, fills the ChatGPT composer, clicks Send, and acknowledges success only after the submitted user turn is observable.

## MCP/server contract

The bridge keeps one active correlation per child, downloads image inputs into ignored private runtime storage, and never exposes Discord channel/thread/message ids to ChatGPT. The same loopback server exposes MCP JSON-RPC at `POST /mcp` with one tool:

- Every model-visible inbound turn contains `data.correlationId`. Call `reply_to_discord({ correlationId, text, final? })` with that value. The correlation is the deterministic reply route for this turn; the model does not choose Discord channels.

MCP HTTP access remains authenticated by private runtime credentials. Extension Project assignment is intentionally separate from MCP authentication.

For local MCP clients, run `skills/family-tutor/mcp-server/src/browser-mcp-stdio.mjs`. It accepts `FAMILY_TUTOR_BRIDGE_URL` plus `FAMILY_TUTOR_BRIDGE_TOKEN`, `FAMILY_TUTOR_BRIDGE_TOKEN_FILE`, or the private Family Tutor runtime token resolved from `FAMILY_TUTOR_CONFIG` / `FAMILY_TUTOR_INSTANCE_DIR`.
