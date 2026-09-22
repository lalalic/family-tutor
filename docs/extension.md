# Family Tutor Chrome extension

The extension is an unpacked Manifest V3 release for families who use their own
ChatGPT account and Projects. It is a browser-side adapter, not a replacement
for ChatGPT authentication and not a local MCP federation layer.

## Release contents

The release artifact is the directory `skills/family-tutor/extension/`. Load it
with Chrome's **Load unpacked** action. The version shown in the popup comes
from `manifest.json`; increment that value for every distributed update.

Before distribution, run:

```bash
npm run check:extension
```

The check validates JavaScript syntax and the protocol tests. A release should
also be tested manually with one disposable ChatGPT Project thread: assign it
to a child, restart Chrome, send a turn, close/reopen the Project tab, and
confirm that the popup reports the bridge state and the same child binding.

## Customer boundary

Families authenticate to ChatGPT themselves. The extension stores only the
logical child-to-Project binding and the selected thread URL in Chrome local
storage. It does not ask the family for a ChatGPT password, bridge token, or
Discord channel ID. For hosted customers the extension connects outbound to
`wss://family-tutor.qili2.com/ws` and authenticates after connection with
a scoped family session token stored in Chrome extension storage. The token is
never placed in the WebSocket URL. The legacy loopback bridge remains supported
for local dogfood only.

The `family-tutor` tab group is the ownership boundary: turns are sent only to
the grouped tab selected for that child. A page outside the group is never
used just because its Project ID matches.

## Recovery and diagnostics

On startup, the service worker reconstructs the group from persisted bindings.
It reuses an exact saved thread when possible, otherwise a matching Project
tab, and only then opens the Project. A content-script failure reloads and
retries the same tab; it never deletes the selected tab. The popup displays the
extension version, bridge state, recovery count, and a short sanitized error
when recovery is in progress or has failed. Errors sent back to the local
bridge are sanitized too; support diagnostics must never include credentials,
tokens, or full browser URLs.

If the hosted bridge is unavailable, verify the hosted endpoint and reconnect Family Tutor in the popup if the OAuth session was revoked and wait for the state to move from `recovering` to
`connected`. In local dogfood mode, verify the local Family Tutor runtime. If a single Project tab is
stuck, reload that tab. If a binding is wrong, unassign it and assign the
intended Project thread again. Do not copy tokens or full browser URLs into a
support ticket.

## Updating

1. Stop using the old unpacked extension directory.
2. Replace it with the new release directory.
3. In `chrome://extensions`, press **Reload** for Family Tutor.
4. Confirm the popup version and bridge state before sending a child turn.

Bindings are kept by Chrome extension storage, but the extension ID must remain
stable. Keep the manifest `key` unchanged for customer updates; changing it
creates a new extension identity and can strand existing bindings.


The toolbar badge shows the number of children currently bound to ChatGPT Projects. Its badge/icon health follows the bridge state: green when connected, amber while recovering, red on error, and gray while disconnected. The popup renders the server-provided child list dynamically and does not impose a fixed family-size limit.

## Hosted connection

Extension 2.4.0 uses the hosted bridge by default and obtains its extension session through OAuth/PKCE in the popup. Click **Connect Family Tutor**. The extension opens the Family Tutor OAuth/PKCE flow using Chrome Identity, exchanges the one-time authorization code for an extension-scoped session token, stores the extension access/refresh session in extension-local storage, silently refreshes the short-lived access token when needed, and then connects to `wss://family-tutor.qili2.com/ws`. Users do not copy or manage a family token. A hosted connection is not considered ready until the server authenticates the extension session and every expected child binding has reported `tab.bind`.

During optional project setup, the extension fetches the generic learner Project
Instructions template from `/v1/learner-profile-template` and applies it to each
new or reused ChatGPT Project. The response contains only Neo's bootstrap link,
one-learner isolation wording, and editable profile placeholders. Learner values
are entered in ChatGPT Project Instructions; Family Tutor does not persist learner
profiles on its servers. The bootstrap is served at
`https://family-tutor.qili2.com/bootstrap/latest`, and current tool discovery
determines available capabilities.


### Automatic family claim (2.6.2+)

The normal hosted setup path no longer asks a parent to copy a token or manually start extension OAuth. After **Add Family Tutor**, Family Tutor redirects to `/setup/<short-lived-claim>`. Extension 2.6.7 recognizes that page, redeems the one-time claim, receives a family-scoped access/refresh session plus the configured learner names, and reconnects automatically. The popup then lists those learners so the parent only needs to link or relink each learner to the current ChatGPT Project/thread.

The setup page never receives the Discord guild ID, internal family ID, or long-lived credentials. Popup OAuth remains a relink/fallback path after the server already has a Family Installation.


## ChatGPT connection token

Some ChatGPT install surfaces request an auth token instead of initiating OAuth. After the family installation is connected, the extension exposes **Connect ChatGPT**. It requests a dedicated family-scoped MCP bearer token from the hosted service and copies it only after an explicit user click. This token is distinct from the extension access/refresh session, contains no Discord provider ID, expires after 30 days, and is accepted only by the Family Tutor MCP resource. OAuth remains supported when the ChatGPT install surface offers it.


## Setup Help

The extension popup includes **Setup Help**. The page lists the full customer setup path: enable ChatGPT Developer Mode, create the Family Tutor ChatGPT app/MCP connection, prepare the dedicated auth token when requested, create/link one ChatGPT Project per kid, verify connection, and send a test message. **Try auto setup** is optional and best-effort; it may create/link missing kid projects, prepare the auth token, and open ChatGPT setup, but ChatGPT account/workspace confirmations remain user-controlled.


During first-time setup, claiming the family session does not require Discord channels to be ready. Setup Help checks `/v1/setup/status` and shows a waiting state until the parent and all configured kid channels exist. It starts Project setup only after Discord is ready. When all Projects are linked, `/v1/setup/finish` sends idempotent welcome/help messages to each kid channel and the parent channel.


## Chrome Web Store rollout

The hosted service does not assume a single baked-in extension ID. Set `FAMILY_TUTOR_EXTENSION_IDS` to the comma-separated Chrome extension IDs accepted for setup/reconnect (for example, the Store ID plus a temporary pilot ID during migration). Set `FAMILY_TUTOR_EXTENSION_INSTALL_URL` to the Chrome Web Store listing URL once published; until then the setup hub falls back to the versioned self-hosted ZIP. These values change deployment configuration only and do not require another extension source release.
