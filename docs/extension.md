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
`wss://family-tutor.qili2.com/extension` and authenticates after connection with
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

If the hosted bridge is unavailable, verify the hosted endpoint and family
session in the popup and wait for the state to move from `recovering` to
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

## Hosted connection

Extension 2.3.0 adds hosted bridge configuration in the popup. Enter the hosted `wss://family-tutor.qili2.com/extension` endpoint and the family session token issued during onboarding. A hosted connection is not considered ready until the server authenticates the session and every expected child binding has reported `tab.bind`.
