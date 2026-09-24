# Founding-family pilot offer and payment gate

Status: decision brief; not an approved price, contract, or payment integration.

This brief turns the current implementation into one sellable pilot shape while
leaving owner-approved commercial decisions explicit. It is intentionally based
on the product that exists today, not on planned capabilities.

## Recommended offer shape

Sell one assisted, family-level founding pilot rather than a menu of plans:

> Family Tutor sets up and supports a private learning space for each child in
> the family's Discord and ChatGPT Projects, then provides the hosted routing,
> parent learning telemetry, and any explicitly agreed premium capability for
> the pilot term.

The commercial unit is one family, not one child, message, or tutor response.
The family brings and continues to pay for its own ChatGPT account and Discord
server. Family Tutor does not sell curriculum, ChatGPT access, or a guarantee
of learning outcomes.

### Included in the base pilot

- assisted family authorization and setup;
- one parent destination and a separate logical/private tutor destination for
  each configured child;
- the customer's own ChatGPT Project/thread path for each child;
- core Family Tutor routing and Discord delivery;
- parent-facing, privacy-filtered learning telemetry rather than routine child
  transcript mirroring;
- setup acceptance checks, support through the agreed support channel/hours,
  and the documented suspension, export, and deletion request paths.

### Premium boundary

The only currently implemented hosted premium tool is `create_study_plan`.
It must remain disabled unless the family's entitlement explicitly includes the
`premium` capability. The entitlement is family-scoped and is enforced by the
hosted MCP adapter; it is not inferred from a payment description or from model
input.

Voice, image, source-grounded study, reminders, and other outcomes may be part
of a pilot only when the exact deployment path is verified and the capability
is written into that family's approved scope. They are not included in the
generic offer by implication.

### Explicitly not included

- ChatGPT Plus/Developer Mode, Discord, hosting, or other third-party fees;
- curriculum, teacher, therapist, medical, legal, or safeguarding services;
- guaranteed grades, outcomes, response times, or always-on availability;
- parent access to routine child tutor transcripts;
- unrestricted custom development or unbounded support;
- payment-provider fees, taxes, refunds, credits, or chargeback handling until
  the owner approves the policy.

## Decisions requiring owner approval

Approve one row before publishing a price or charging a family:

| Option | Commercial shape | Trade-off |
| --- | --- | --- |
| A — assisted pilot (recommended) | One setup fee plus one recurring family fee for a defined pilot term | Best matches the real setup/support burden and creates a clean entitlement period |
| B — pilot subscription | One recurring family fee with setup included | Simpler to explain, but setup work is harder to recover if a family leaves early |
| C — prepaid pilot term | One payment for a fixed term, no automatic renewal | Lowest billing complexity, but weaker continuity signal and less predictable support revenue |

The owner must select the option and approve: amount/currency, pilot term,
included child count or expansion rule, support hours/channel, renewal or
expiry behavior, refund/credit policy, taxes/invoices, and whether the pilot
is invite-only. Until then, the public site must remain enquiry-led and must
not show a price.

## Payment-to-entitlement architecture after approval

Keep payment processing outside Family Tutor's core and store only a minimal,
provider-neutral entitlement projection:

1. An operator creates a family offer/order with an opaque internal reference.
2. The payment provider hosts checkout or invoice collection; card data and
   provider secrets never enter Family Tutor.
3. A signature-verified webhook is accepted idempotently and records only the
   payment reference, event type, amount/currency metadata needed for
   reconciliation, and timestamps.
4. The webhook projects `premium` (or the approved capability key) onto the
   authenticated family with an explicit status and `startsAt`/`endsAt`.
5. The MCP adapter reads the active projection when listing/calling tools;
   expiry, cancellation, refund, chargeback, suspension, or operator revocation
   removes access without changing family routing or child data.
6. Reconciliation and entitlement changes are auditable with redacted request
   and payment references only. Duplicate webhook delivery must not duplicate
   access or records.

The current `entitlements` object passed to `createHostedMcpAdapter` is a
deployment-time map, not a payment system. Do not connect a checkout directly
to that process-local option. The implementation follow-up needs a
transactional entitlement store, signed webhook verification, idempotency,
operator reconciliation, and tests for grant, expiry, refund, duplicate, and
cross-family isolation.

## Payment gate

No family is charged until all of these are true:

- owner-approved offer, price, term, support, and refund/credit policy;
- owner/counsel-approved customer/privacy/consent wording for the target
  market;
- deployed hosted path and real child/parent acceptance evidence are green;
- payment provider account, webhook secret, invoice/tax handling, and operator
  ownership are configured outside the repository;
- entitlement projection and revocation have passed the hosted isolation suite;
- the family has accepted the scope and knows that third-party account fees are
  separate.

Until the gate is met, record the family as an enquiry or approved pilot
candidate, not as paid, active premium, or revenue.

## Implementation follow-up after approval

The next implementation task should add the smallest provider-neutral
entitlement projection to the transactional provisioning boundary, then add a
single approved payment-provider adapter and webhook tests. It must not add
payment secrets, child content, raw Discord/provider IDs, or private family
identifiers to source, logs, events, or fixtures.
