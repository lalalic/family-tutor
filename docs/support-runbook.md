# Family Tutor pilot support runbook

This runbook is for the operator supporting a private pilot. It intentionally
keeps child content out of routine support notes.

## Support priorities

1. Safety concern or suspected unauthorized access: respond immediately and
   use the minimum necessary information.
2. Cross-family/cross-child routing suspicion: suspend the affected family,
   preserve redacted request IDs, and stop further delivery until reviewed.
3. Authentication, binding, or acceptance failure: resolve during the agreed
   support window.
4. Normal setup questions and product feedback: acknowledge and schedule.

Never ask a parent to paste a child transcript into a support ticket. Request
timestamps, family ID, logical destination, request ID, and the observed safe
error instead.

## Triage checklist

- Identify the family through the authenticated support record; do not trust a
  channel ID supplied in a chat message.
- Confirm family status is active and the session is unexpired/not revoked.
- Check the logical child/parent binding and scope, then rate-limit decisions.
- Review redacted audit metadata for request ID, tool, destination type/key,
  outcome, and rejection reason.
- Confirm provider delivery only at the adapter boundary; never expose the
  provider ID to the customer.
- If the issue involves another family or child, stop and escalate as an
  isolation incident.

## Safe responses

Use errors such as “authentication failed,” “destination is not bound for this
family,” or “request rejected.” Do not reveal whether another family's route,
provider ID, session hash, or transcript exists.

## Incident response

For suspected privacy or routing incidents:

1. Record an incident ID, time, affected family, and operator.
2. Suspend the family and revoke relevant sessions.
3. Disable the affected tool or handler if the blast radius is unclear.
4. Preserve redacted audit metadata; do not copy message content into tickets.
5. Test two synthetic families and two synthetic children for isolation.
6. Notify the owner and follow the approved legal/customer notification plan.
7. Re-enable only after a documented fix, regression test, and acceptance test.

Legal notification timelines, regulator decisions, and customer-credit policy
require explicit owner/counsel approval.

## Account closure

Use the privacy procedure in `docs/privacy-consent.md`: suspend, revoke,
export only the approved redacted record, remove runtime state, and confirm
completion. The current code does not yet provide a single self-service
delete/export command; do not claim that it does.

## Support service levels for the pilot

Recommended starting targets: acknowledge urgent incidents within 1 hour during
the agreed window, normal setup issues within 1 business day, and product
feedback within 3 business days. Confirm timezone, channel, holidays, and
after-hours handling in the family agreement.
