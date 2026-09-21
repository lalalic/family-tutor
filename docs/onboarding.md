# Family Tutor customer onboarding

This is the customer-facing setup contract for a new family. It is designed for
a hosted Family Tutor deployment and does not require the family to edit JSON,
copy provider channel IDs, or configure a local MCP server.

## What the family needs

Before starting, confirm that the customer has:

- a ChatGPT Plus account with Developer Mode available;
- one ChatGPT Project per child, with the child-specific tutor instructions;
- a Discord server where the parent controls invitations and channel privacy;
- the Family Tutor Chrome extension installed from the supplied release; and
- the Family Tutor setup link or invitation code from the operator.

The setup operator creates the family account and child records. The family
selects destinations by name in the setup UI. Provider IDs, session tokens, and
Discord credentials remain inside the trusted provisioning and adapter services.

## Setup sequence

1. **Prerequisites.** The setup screen checks Chrome, ChatGPT Plus/Developer
   Mode, extension health, and the Discord permission needed to invite the bot.
   Missing checks are shown as actionable instructions; no partial success is
   presented as complete.
2. **ChatGPT and MCP.** In ChatGPT Developer Mode, add the hosted Family Tutor
   MCP connection using the operator-supplied setup link. Complete the browser
   authorization flow and return to the setup screen. The screen must show both
   ChatGPT connected and the MCP configured before continuing.
3. **Discord bot.** Use the operator-supplied invite action to add the shared
   Family Tutor bot to the family server. The bot must be able to read/send in
   the parent channel and the selected child channels only.
4. **Destinations.** Choose one parent destination and one private child
   destination per provisioned child. The service stores logical keys such as
   `parent` and `alex`; it never accepts a raw Discord channel ID from the
   model-facing setup flow.
5. **Projects.** Open each child's ChatGPT Project thread and assign the tab to
   that child in the extension. The extension verifies the project URL and
   keeps exactly one managed tab for each child. A project is not marked bound
   until the extension confirms it.
6. **Acceptance.** Run the built-in acceptance test. It sends a distinct probe
   for each child, verifies each reply returns to the same child destination,
   verifies concise parent telemetry, and checks that no cross-family or
   cross-child response is visible.

## Incomplete setup and recovery

Setup is resumable. The status screen identifies the first incomplete step and
lists missing child Projects. A failed check must display a short, privacy-safe
message and a retry action. It must not display access tokens, provider IDs,
channel IDs, private endpoints, child messages, or stack traces.

Common recovery actions:

- MCP disconnected: reopen the hosted MCP connection in Developer Mode and
  retry the ChatGPT check.
- Bot invite pending: finish the Discord authorization and retry; do not create
  a second bot or manually paste IDs.
- Destination rejected: select a destination from the server picker and verify
  the child channel is private to that child and Neo.
- Project not detected: open the exact ChatGPT Project thread, confirm the
  extension is healthy, and assign the tab again.
- Acceptance failed: stop onboarding, fix the named check, then rerun the full
  acceptance test. Never treat a partial probe as a pass.

## Operator acceptance record

Record only the family ID, setup timestamp, pass/fail result, and the names of
failed checks. Do not copy child prompts, replies, or transcripts into the
record. The acceptance result is complete only when all of these checks pass:

- ChatGPT Developer Mode and hosted MCP are connected;
- the shared bot is invited and authorized;
- parent and every child destination are bound;
- every child has one extension-confirmed ChatGPT Project;
- each child probe returns to its own channel;
- parent output is learning telemetry, not a transcript mirror; and
- unauthorized cross-family and cross-child access is rejected.

If the family cannot complete setup, leave it in an incomplete state and hand
the operator the failing step plus the safe recovery action. Do not ask the
family to edit configuration files as a workaround.
