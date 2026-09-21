# Family Tutor ChatGPT extension

This unpacked Manifest V3 extension is the browser side of Family Tutor. The user-facing configuration is only `child -> ChatGPT Project`. When a user assigns the current ChatGPT Project thread tab to a child, that exact tab is moved into a dedicated Chrome tab group named `family-tutor`.

## Tab ownership

- The `family-tutor` group contains exactly one managed ChatGPT tab per bound child.
- Assigning a child from the popup makes the current Project/thread tab that child's managed tab.
- Reassigning a child keeps only the newly selected tab in the managed group; the previous managed tab is ungrouped rather than deleted.
- The extension sends Family Tutor turns only to tabs inside the `family-tutor` group. A matching ChatGPT tab outside the group is never used for a turn.
- If Chrome restarts, the extension reconstructs the `family-tutor` group from the persisted child-to-Project bindings. It reuses an existing matching Project tab when available and otherwise opens the Project, then groups exactly one tab for each child.
- A temporary content-script failure never causes the selected thread tab to be deleted. The extension reloads and retries the same grouped tab.

## Setup

1. In Chrome, load `skills/family-tutor/extension` as an unpacked extension.
2. Open the ChatGPT Project thread you want a child to use.
3. Open the extension popup and choose **Assign this tab to <child>**.
4. Repeat for each child. The extension creates and maintains the `family-tutor` tab group automatically.

The extension does not expose a bridge token, loopback port, bridge URL, or tab id as user configuration. It connects to the fixed local Family Tutor bridge as implementation plumbing. Attachment bytes are fetched by the background service worker, not by the ChatGPT page.
