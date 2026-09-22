# Customer onboarding and acceptance

Family Tutor onboarding is an assisted, no-JSON-editing flow on the hosted
product composition. A support operator or product UI calls
`product.onboarding(familyId)` from `packages/integration`; it delegates to the
real provisioning store, MCP, Discord, and extension interfaces while keeping
provider IDs, bearer tokens, and child messages inside trusted adapters.

## Customer path

1. On the Family Tutor site, choose **Add Family Tutor**. If the user has no Discord account, Discord handles sign-in/account creation. If the user has no Discord server, instruct them to create a family server first, then restart **Add Family Tutor**; no setup claim exists until a server is selected.
2. Discord opens. Choose the family server and authorize Family Tutor.
3. Discord redirects back to the single `/setup/<claim>` setup hub. The page shows the short-lived setup code, the configured kids, the extension download, and two ways to continue: **Manual setup** or **Setup with Codex**.
4. Manual setup follows the canonical checklist on that page: install the extension, let it claim the family, enable ChatGPT Developer Mode, add the Family Tutor MCP/app, create/link one ChatGPT Project per kid, then verify with a kid message and parent reminder.
5. Setup with Codex copies the same canonical checklist plus the current setup URL/code. Codex should automate everything it safely can and stop only for Discord/ChatGPT security or authorization confirmations. It must not print or persist setup codes, auth/refresh tokens, provider IDs, or child conversation content.
6. Extension 2.6.7+ automatically redeems the setup claim when the setup page is opened. Claim redemption is one-time, but the setup page remains usable through the claim lifetime so the user can finish the remaining steps from the same URL.
7. Claiming establishes the family session even if Discord parent/kid channels are still being prepared. The extension shows a waiting state, polls setup readiness, and does not start ChatGPT Project setup until the channels are ready.
8. After every kid Project is linked, finishing setup sends one idempotent welcome/help message to each kid channel and one to the parent channel.
9. Run acceptance. Distinct child probes must return to their originating child destinations, parent reminders must reach the named child and confirm to the parent, and cross-family/cross-child routes must be rejected.

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
