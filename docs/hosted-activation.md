# Hosted activation readiness

This is the activation gate for the shared hosted Family Tutor product. A
passing local test or a reachable web page is not evidence that a customer can
use the full path. Do not enable customer traffic until the owner-controlled
deployment gates and the real Discord acceptance checks below are complete.

## Repository and deployment preparation

Run from the reviewed checkout:

```bash
npm run check
git diff --check
```

Deploy the reviewed commit through the approved platform. The deployment must
provide a transactional provisioning store, the trusted Discord provider
module, platform-managed secrets, TLS termination, process supervision, and
alerts. Keep the service bound privately behind the TLS edge. Never put a
secret, bearer token, provider ID, or child content in a URL, command, log, or
tracked file.

These are owner-controlled gates and cannot be completed by repository code:

- platform secret-manager access and provider credentials;
- DNS/TLS ownership for the public origin;
- transactional database provisioning and restore rehearsal;
- Discord bot authorization and the family's prepared channels;
- ChatGPT Developer Mode authorization and the family's Project/thread setup;
- legal/privacy approval, support ownership, and the go/no-go decision.

## Public activation probe

After deployment, run the safe probe with the public HTTPS origin:

```bash
FAMILY_TUTOR_PUBLIC_ORIGIN=https://your-approved-origin.example \
  npm run verify:hosted-activation
```

The command checks only data-free `GET /healthz`, `GET /readyz`, and the
generic `/bootstrap/latest.md` response. It does not accept credentials, call
an authenticated family route, or claim that deployment is complete. A
failure is a no-go.

## Authenticated and real-family acceptance

An owner or authorized operator must then complete the procedure in
[`e2e.md`](../e2e.md): authenticate the family-scoped MCP session, connect the
extension over `wss://` without putting a token in the URL, bind every child to
a distinct Project/thread, and send distinct probes to the real private child
channels. Verify every reply returns to its originating channel, parent
output is telemetry only, cross-family/cross-child access is rejected, and
logs contain no credentials, provider IDs, or learner content.

Record only the approved release/version, probe result, endpoint paths,
logical child labels, request/correlation IDs, and pass/fail status in the
private launch record. Record the exact owner gate and next action when any
external prerequisite is unavailable. Never manufacture a successful
activation result from local tests.
