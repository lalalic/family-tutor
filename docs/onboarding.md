# Customer onboarding and acceptance

Family Tutor onboarding is an assisted, no-JSON-editing flow on the hosted
product composition. A support operator or product UI calls
`product.onboarding(familyId)` from `packages/integration`; it delegates to the
real provisioning store, MCP, Discord, and extension interfaces while keeping
provider IDs, bearer tokens, and child messages inside trusted adapters.

## Customer path

1. On the Family Tutor site, choose **Add Family Tutor**. If the user has no Discord account, Discord handles sign-in/account creation. If the user has no Discord server, instruct them to create a family server first, then restart **Add Family Tutor**; no setup claim exists until a server is selected.
2. Discord opens. Choose the family server and authorize Family Tutor.
3. Discord redirects back to the canonical hosted setup guide. The public `/setup` guide and claim-bearing setup URL are the same product surface: the claim URL identifies the family setup session, while the page itself remains the authoritative setup manual. Do not maintain a second setup-help/manual inside the extension.
4. The hosted guide exposes a stable `?step=<step>` selector so a user, Codex, support flow, or product link can open the guide directly at the current setup step. The page may still show overall progress and prerequisite state, but the selected step is explicit in the URL and must remain shareable/bookmarkable without exposing credentials or provider IDs.
5. The canonical guide describes the full ChatGPT-side setup, including installing/connecting the Family Tutor plugin/app/MCP, enabling ChatGPT Developer Mode, and creating/linking one dedicated ChatGPT Project per kid. Manual setup follows this guide from start to finish.
6. **Setup with Codex** uses the same hosted setup URL as its source of truth. Codex should open/read the canonical guide, inspect the current step, and perform every safely automatable setup action from that guide. It should stop only for Discord/ChatGPT security, authorization, or other user-presence gates. It must not print or persist setup claims, auth/refresh tokens, provider IDs, or child conversation content.
7. The extension may expose an **Auto Setup** button that best-effort attempts all setup actions it can perform safely, including the browser/ChatGPT steps described by the hosted guide. The extension must not contain a parallel help/manual experience. The hosted setup guide tells the user that **Auto Setup** exists, what it will try, and that manual completion may still be required for protected steps. Claim redemption may happen automatically from the claim-bearing setup page; claiming establishes the family session even if Discord parent/kid channels are still being prepared, so the extension shows a waiting state, polls readiness, and does not start child Project setup until the destinations are ready.
8. After every kid Project is linked, finishing setup sends one idempotent welcome/help message to each kid channel and one to the parent channel.
9. Run acceptance. Distinct child probes must return to their originating child destinations, parent reminders must reach the named child and confirm to the parent, and cross-family/cross-child routes must be rejected.

## Canonical setup guide contract

The hosted setup guide is intentionally the only human-readable setup procedure.
It serves all of these roles at once:

- public onboarding guide at `/setup`;
- claim/session landing page after Discord authorization;
- current-step deep link through `?step=<step>`;
- the manual procedure followed by a person;
- the instruction source followed by Codex;
- the explanation of the extension's **Auto Setup** button and its limits.

The extension may automate setup, display progress/readiness, and deep-link back
to the relevant hosted step, but it must not duplicate the guide content. This
keeps the human path, Codex path, and extension automation aligned to one
versioned product contract instead of three drifting setup procedures.

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
