# Customer onboarding and acceptance

Family Tutor onboarding is an assisted, no-JSON-editing flow on the hosted
product composition. A support operator or product UI calls
`product.onboarding(familyId)` from `packages/integration`; it delegates to the
real provisioning store, MCP, Discord, and extension interfaces while keeping
provider IDs, bearer tokens, and child messages inside trusted adapters.

## Customer path

1. Confirm prerequisites: supported Chrome, ChatGPT Plus with Developer Mode,
   the Family Tutor extension, and a Discord server where the owner can
   authorize the shared bot.
2. Connect ChatGPT Developer Mode to the hosted Family Tutor MCP endpoint.
   Setup remains incomplete until both ChatGPT and MCP are reachable.
3. Invite the shared Family Tutor Discord bot using the guided authorization
   link. Never paste a bot token into onboarding.
4. Choose one parent destination and one private child destination per learner.
   The flow accepts logical keys only; the trusted Discord adapter resolves
   those keys to provider channel IDs.
5. Open each learner's ChatGPT Project and bind its Project ID to exactly one
   child. The extension confirms the Project tab and binding; the flow never
   stores conversation transcripts.
6. Run acceptance. The probe verifies same-child replies, concise parent
   telemetry, and rejection of cross-family/cross-child routes.

## Safe incomplete states

The coordinator exposes the first incomplete step, missing Project bindings,
per-step checks, and a short safe detail. Endpoint URLs, provider IDs,
credentials, and raw errors are redacted. A failed prerequisite, bot invite,
binding, or extension check never marks setup complete.

Support can retry a failed step after the customer fixes the issue; no JSON or
private runtime state needs to be edited.

For a local product rehearsal, run `npm run check:product`. It provisions two
synthetic families through the same composition, completes their onboarding and
Project readiness checks, sends MCP traffic through Discord, verifies isolation,
and exercises export, delete, and session revocation. This is complementary to
the real Discord acceptance path below, not a replacement for it.

## Acceptance checklist

- [ ] ChatGPT Developer Mode is connected to Family Tutor MCP.
- [ ] Shared Discord bot is invited to the customer server.
- [ ] Parent and every child destination are bound through logical keys.
- [ ] Every child has a unique ChatGPT Project binding.
- [ ] Extension health confirms the expected Project tabs.
- [ ] Distinct child probes return to their originating child destinations.
- [ ] Parent channel receives learning telemetry, not a transcript.
- [ ] Cross-family and cross-child access attempts are rejected.

The real Discord acceptance path remains the release gate; unit tests alone do
not prove provider routing.
