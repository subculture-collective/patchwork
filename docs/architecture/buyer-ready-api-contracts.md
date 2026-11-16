# Buyer-ready HTTP contract map

Updated: 2026-07-28

This is a reader-facing map of the implemented HTTP surface. Executable
validation remains in shared schemas, handler tests, and the service code.
The API advertises bounded production scheduling, group, and chat routes; the
legacy fixture `/chat/initiate` route remains absent.

## Common boundaries

- Authenticated commands derive the actor DID from the restored server
  session. Browser-supplied identity, role, origin, verification, and approval
  fields are not authority.
- Browser mutations require the CSRF cookie/header pair. Durable commands also
  require an `Idempotency-Key`.
- Current 18+ policy consent gates protected actions.
- New-submission and exact-exchange routes return `503` with the stable
  maintenance error while read-only mode is active.
- Errors use `{ "error": { "code", "message", "details"? } }`; safe errors
  never reflect credentials, exact coordinates, evidence, or raw moderation
  content.

## Public reads

| Method/path | Result |
| --- | --- |
| `GET /status` | Public maintenance/read-only state |
| `GET /query/map` | Ranked approximate aid markers |
| `GET /query/feed` | Ranked aid cards |
| `GET /query/directory` | Directory cards and only currently approved exact public-resource addresses |
| `GET /query/volunteers` | Public volunteer profiles and approximate service areas |
| `GET /organizations` / `GET /organizations/profile` | Public organization profiles, provenance, and non-participation labels |

`GET /organizations` optionally accepts `page` (1–100000), `pageSize` (1–100)
and `dataset` (`all`, `community`, `demo`). Supplying any selects bounded SQL
pagination and adds `total`, `page`, `pageSize` and `hasNextPage` alongside
`organizations`. Omitting them preserves the legacy unpaged response. The
native caller uses pages of 20; search text remains bounded to 120 characters.

Discovery records can include the server-issued `recordOrigin` value
`synthetic`, `sourced-public`, or `visitor-created`. Clients must treat an
absent value from an older server as `visitor-created`, never as synthetic.

## Identity and account

| Family | Routes |
| --- | --- |
| OAuth/session | `/auth/login`, `/auth/callback`, `/auth/session`, `/auth/refresh`, `/auth/logout` |
| Managed account | `POST /auth/signup` followed by the same OAuth flow |
| Consent/preferences | `GET /account/onboarding`, `POST /account/consent`, `GET/PUT /account/preferences` |
| Privacy rights | `GET /account/export`, `POST /account/deactivate` |

Account export labels the subject and public projections with their
server-issued origin. Showcase identities cannot invoke visitor deactivation.

## Public-record owner commands

- `POST/GET/PUT/DELETE /at/aid-posts`
- `POST/GET/PUT/DELETE /at/directory-resources`
- `POST/GET/PUT/DELETE /at/volunteer-profile`

Create/update passes the pre-publication safety gate before any PDS mutation.
Location is approximate and at least 1 km precision. Origin, verification, and
exact-address approval are never accepted from these records.

## Private product workflows

| Domain | Routes |
| --- | --- |
| Lifecycle | `/aid/post/lifecycle`, `/aid/post/transition`, assignment/response/handoff/reconcile routes |
| Organizations | `/organizations/mine`, invitations, members, roles, stewardship, audit |
| Verification | `/verification/mine`, applications, appeals, moderator decisions, exact-address request/review/decision |
| Attachments | `GET /attachments`, upload authorization, access, review, delete |
| Coordination | `/coordination/mine`, `/coordination/pickups`, offers, offer decisions, connections, matches |
| Scheduling | `/coordination/windows`, `/coordination/window-decisions` |
| Groups | `/groups`, invitation/response/revocation, member/role/departure/ownership/closure, room/room-closure routes |
| Bounded chat | `/chat/conversations`, `/chat/messages`, `/chat/read`, `/chat/messages/redactions`, `/chat/reports` |
| Activity/outcomes | `/inbox`, `/inbox/read`, `/outcomes`, `/outcomes/mine` |
| Notifications | `/notifications`, read/read-all/archive, email confirmation, push subscription/revocation |
| Exact exchange | `/location/session`, `/location/consent`, `/location/signal`, `/location/revoke` |

Exact-location signaling contains authorization/session and encrypted signaling
material only. Exact latitude/longitude is never an accepted server field.

## Safety and operator routes

- `POST /blocks` and `POST /reports` are session-owned user safety commands.
- Moderator worker routes expose queue, safe review, policy action, appeals,
  and audit only to configured internal/API capability boundaries.
- `GET /maintenance`, `POST /maintenance/declare`, and
  `POST /maintenance/resume` require `maintenance_mode:manage`; resume is
  audited and cannot override an environment shutdown.

## Explicit absence and payload boundary

The legacy fixture `/chat/initiate` route is not registered or advertised.
Message bodies are accepted only in the authenticated JSON mutation for
`POST /chat/messages`; they are forbidden from query strings, list previews,
notifications, audit rows, metrics, and unrelated moderation history.

### Bounded pickup capacity (#132)

`POST /coordination/pickups` uses the existing authenticated, CSRF-protected,
idempotent mutation boundary. Identity comes from the session. Commands are:

```json
{"requestUri":"at://did:plc:requester/app.patchwork.aid.post/pickup","action":"set-capacity","helperCapacity":2}
```

```json
{"requestUri":"at://did:plc:requester/app.patchwork.aid.post/pickup","action":"close"}
```

Only the requester may configure or close the pickup. Capacity is an integer
from 1 to 20 and cannot be reduced below committed places. Existing requests
retain the single-helper lifecycle until explicitly configured; an active
legacy assignment cannot be converted. Pickup mode cannot be disabled.
`GET /coordination/mine` adds requester-owned `pickups`, including capacity,
committed count, active count, configured state, and workflow status. Helpers
receive only their own offers and connections, not other helpers' arrangements.

Acceptance locks the request before admitting a helper. Active and completed
connections occupy places. Pending offers are retained at capacity; the
requester may decline them. Cancellation or the existing 30-day connection
expiry releases a place. Repeated acceptance returns the original commitment,
and repeated completion/cancellation does not apply the effect twice.
Each completion records its connection and existing feedback authority without
resolving the pickup. Closure requires zero active arrangements and cancels
remaining pending offers. No helper's completion completes another helper.
Scheduling conflict, safety, moderation, block, and deactivation checks remain
in force.

The implementation and verification sequence is recorded in
[the bounded pickup plan](../superpowers/plans/2026-10-28-bounded-pickup-capacity.md).

### Public group join requests (#134)

All routes require a signed-in session. `GET /groups/details?groupId=<uuid>` returns only `id`, `name`, `purpose`, `description` and `memberCount` for an available public group. Private, missing, closed, blocked and held groups return the same `GROUP_NOT_FOUND` 404. Shared links use `/groups?group=<uuid>`; there is no directory or search endpoint.

`GET /groups/join-requests` lists the caller’s own requests and eligible pending requests for current owners/moderators, capped at 100. Ordinary members cannot read applications or their threads. `POST /groups/join-requests` accepts only `{ groupId, introduction }`; the introduction is one paragraph of 1–1,000 characters with control characters rejected. One pending request per applicant/group is enforced transactionally and by a unique index. Commands use the existing session-owned, CSRF-protected `Idempotency-Key` boundary.

`POST /groups/join-decisions` accepts `{ groupId, requestId, action }`: `approve` and `decline` require a current owner/moderator; `withdraw` requires the applicant. A seven-day deadline applies before the sweep runs. Approval uses the invitation membership path and grants only `member`. Group locks serialize replies and decisions; the first concurrent decision wins and the other receives `GROUP_JOIN_CLOSED`.

Each request creates a `join-request` chat conversation. Replies use the existing bounded `/chat/messages` API, with pagination, receipts, redaction and reporting. Access is recalculated for the applicant and current owner/moderators on every operation, including account status, blocks, group/participant moderation and chat holds. Blocks among these participants hide the entire application thread. Ordinary membership never grants access. Approval, decline, withdrawal, expiry and group closure end thread access. The introduction is stored on the request; replies are stored in chat messages. Neither appears in notifications or audit metadata. Request records and their cascading chat data have a 90-day retention limit; exports include only the account’s own requests. Deactivation removes introduction text, redacts sent chat messages and audit identity, and closes the applicant’s thread.

Apply API migration `0039_public_group_join_requests.sql` before the matching API and web release. Upgrade API readers together before enabling application conversations; earlier readers do not recognize the new chat kind. Rollback removes web entry points while retaining compatible API readers and schema for existing requests. Shared runtime deployment is a separate operation.

### Stripe payment webhooks (donations step 1)

`POST /internal/payments/stripe/webhook` accepts platform-account events and `POST /internal/payments/stripe/connect-webhook` accepts connected-account events. Each endpoint verifies the `Stripe-Signature` v1 HMAC over the exact request bytes with its own signing secret and a five-minute timestamp window. The Connect endpoint requires an `account`; the platform endpoint rejects one. Signed events from the other Stripe mode are acknowledged with `{ received: false, ignored: 'other-mode' }` and not recorded, because a live Connect endpoint also receives connected accounts' test events. The API stores only the event ID, source, account, type, mode and timestamps, and answers `{ received, duplicate }`. A storage failure returns 500 so Stripe retries. A sweep re-fetches each event from Stripe, dead-letters any event whose fetched copy disagrees with the signed delivery, and applies events in Stripe creation order. No event types are applied yet; they are marked `ignored` until later steps add processors. Without all three Stripe settings both paths return `PAYMENTS_UNAVAILABLE`.

Apply API migration `0040_donations_and_supporter_tiers.sql` before the matching API; the API refuses to start without `payment_webhook_events`. `PATCHWORK_PAYMENTS_MODE` defaults to `off`, and webhook intake still runs while it is off. Rollback keeps the schema and its records.

### General-fund giving (donations step 2)

`GET /support/tiers` is public. It returns whether giving is enabled, the Stripe mode, the receipt mode (with legal name and EIN only in charitable mode), the one-time limits ($1–$10,000) with suggested amounts, and the current version of each active tier. `POST /support/checkout` works with or without a session. It requires a UUID `Idempotency-Key` and accepts only `{ recipient: 'general-fund', mode: 'one-time', amountMinor }` or `{ recipient: 'general-fund', mode: 'monthly', tierKey }`. The server sets amounts from its own validation or the current tier version and returns `{ checkoutId, url }`. Replaying a key returns the same Checkout; reusing it for a different request or donor returns `IDEMPOTENCY_KEY_REUSED`, and reusing it after completion or expiry returns `CHECKOUT_CLOSED`. A checkout row is written before Stripe is called, so a retry after a Stripe failure reuses the same Stripe idempotency key. The endpoint has its own 10-per-minute rate limit. With `PATCHWORK_PAYMENTS_MODE=off` it returns `PAYMENTS_DISABLED`.

`GET /support/checkout?checkout=<uuid>` returns the mode, amount, recipient name and status of one Checkout for the return page; it exposes no donor identity. `GET /account/support` lists the signed-in account's own gifts and subscriptions. `POST /support/portal` returns a Stripe Customer Portal URL for the account's general-fund customer; it stays available with payments off so donors can cancel.

Donations and subscriptions change only through re-fetched platform webhook events. Checkout completion creates the gift (pending, succeeded or failed). A full refund marks it refunded; disputes move it to disputed and back on `won` or `warning_closed`. Subscription and invoice events re-fetch the subscription, and a state fetched earlier never replaces newer stored state. Connected-account events are not applied yet.

Operator setup in the Stripe dashboard, per mode: create the two webhook endpoints. The platform endpoint subscribes to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated` and `charge.dispute.closed`. Save a default Customer Portal configuration that allows cancellation and plan switching between the tier prices. Turn on Stripe's successful-payment email receipts. Patchwork's own notice (step 5) only confirms the gift and is not a receipt.

Apply `0041_general_fund_checkout.sql` before the matching API. It adds checkout tracking and seeds three placeholder tiers ($5, $15 and $40 a month), whose names are web translation keys.

### Organization giving (donations step 3)

`POST /organizations/payments/onboarding` takes `{ organizationId }` from an active owner or admin. The organization must be verified (approved, unexpired) and not synthetic, payments must be on, and its recipient must not be suspended. The first call creates one connected account with the organization's name, using idempotency key `patchwork-account-<recipient>`. The account has the full Stripe Dashboard, `controller.fees.payer=account` and `controller.losses.payments=stripe`, so the organization pays its own Stripe fees and Stripe carries negative-balance losses. Every call returns a fresh single-use Account Link that returns to `/organizations?payments=<organization>&onboarding=return|refresh`. `GET /organizations/payments?organization=<uuid>` returns onboarding state, eligibility, a Dashboard link, active monthly supporters, monthly recurring total and 12 months of one-time gift totals. It never returns donor identities. When charges are not yet enabled, it refreshes the account from Stripe.

`GET /support/recipients?organization=<uuid>&…` (up to 100, public) returns the subset that can receive gifts now. An organization is eligible only while all of these hold: the recipient is `active` with Stripe charges enabled, the organization is not synthetic, and it has an approved, unexpired organization verification. `POST /support/checkout` also accepts `recipient: { organizationId }`. Organization Checkout Sessions and monthly Prices are created on the connected account (direct charges) with no application fee. `POST /support/portal` accepts an optional `recipientId`, and `GET /account/support` returns `manageable` recipients instead of `canManage`. The portal stays reachable for recipients that are no longer eligible, so donors can cancel.

Connect webhook events apply only to the recipient that owns the delivering account, and objects are re-fetched from that account. `account.updated` mirrors charges, payouts and details-submitted, and activates an onboarding recipient once charges are enabled. Suspended and closed recipients keep their status. A sweep that runs with webhook processing pauses collection (`pause_collection[behavior]=void`) on active monthly gifts to ineligible organizations, recording `recipient-ineligible` or `recipient-suspended`. Eligibility returning does not resume them. Migration `0042_organization_payment_recipients.sql` closes a recipient before its organization is deleted, so payment history is kept and organization deletion still succeeds.

Operator setup: enable Connect on the platform account, and subscribe the Connect webhook endpoint to the platform event list plus `account.updated` and `account.application.deauthorized`. A disconnected organization stops being eligible and the pause sweep skips it, since Patchwork can no longer act on its account; its event is applied from the signed delivery when Stripe no longer lets the platform fetch it. A later `account.updated` restores it.

### Supporter recognition (donations step 4)

`PUT /account/support/recognition` takes exactly `{ badgeVisible, listedPublicly, shareNameWithRecipient }` as booleans. All three default to false. `GET /account/support` returns the current settings and `isSupporter`. A donor counts as a supporter while they have a monthly gift with status `active` or `trialing` that is not paused. Overdue, paused, cancelled and one-time gifts do not count.

`GET /support/badges?did=…` (up to 100, public) returns the DIDs that show a badge now: the donor turned the badge on and has an active monthly gift to any recipient. `GET /support/supporters` (public, up to 200) returns opted-in general-fund monthly supporters, sorted by DID, so the order reveals neither tier nor tenure. Neither response contains amounts, tiers or recipients. `GET /organizations/payments` adds `namedSupporterDids`: donors who chose to share their name and who give monthly to that organization or gave to it in the last 12 months. Names are never paired with amounts.

Badges are a server-side projection, not AT Protocol records, so a lapsed gift or a changed setting takes effect on the next read.

### Payment lifecycle (donations step 5)

`GET /account/export` adds `data.support`: the account's own gifts and monthly gifts (recipient name, amount, status, dates, tier key) and its recognition settings. It omits Stripe identifiers, card details, the checkout email address and other donors, and lists them under the `payment-processor` exclusion.

`POST /account/deactivate` queues one `cancel-at-period-end` command for each monthly gift that is not already ending, deletes recognition settings, and removes the donor's DID from gifts, monthly gifts, checkout records and Stripe customer mappings, which are kept for accounting. The receipt reports `revoked.monthlyGifts`, `removed.supporterRecognition`, and `retained.paymentDonations`, `paymentSubscriptions` and `paymentAudit`. The webhook sweep sends the queued commands to Stripe with idempotency key `patchwork-cancel-<subscription>`, retrying outages with backoff for up to 10 attempts. A subscription missing from Stripe counts as done. A deactivated moderator's DID on suspensions and payment audit events becomes `deactivated:<sha256>`.

Donors receive notifications of type `support_receipt` (a one-time gift succeeded, or an invoice was paid), `support_payment_failed`, `support_subscription_ending` (a monthly gift was set to end, or ended without notice) and `support_recipient_paused`. Each is sent once per Stripe object. They link to `/settings`, name no amount or recipient, and are not sent for guest or deactivated donors.

`GET /moderation/payment-recipients`, `POST /moderation/payment-recipients/suspend` and `POST /moderation/payment-recipients/restore` require `moderate:users`. The commands take exactly `{ recipientId, reason }` for an organization recipient. Suspending is idempotent and keeps the first reason. Restoring returns the recipient to `active` if Stripe charges are enabled, otherwise to `onboarding`, and does not resume paused gifts. Each change writes a `payment_audit_events` row with the reason.

The private retention sweep deletes gifts, ended monthly gifts and payment audit events after 7 years, and unfinished checkouts and settled webhook receipts after 90 days. Seven years is a placeholder until counsel sets the period. New metrics are `patchwork_payment_commands_pending`, `patchwork_payment_commands_oldest_pending_seconds` and `patchwork_payment_commands_dead_letters`. Apply `0043_payment_lifecycle.sql` before the matching API.

A refund or dispute can reach Patchwork before the Checkout completion that records the gift, because its Stripe event is older and events are applied in creation order. Migration `0044_payment_charge_states.sql` keeps refund and dispute state by PaymentIntent; a gift recorded afterwards starts as `refunded` or `disputed` and gets no receipt notice. Apply it before the matching API. A sandbox run of every payment flow is recorded in `docs/operations/evidence/2026-10-31-stripe-sandbox-donations.md`.

Review follow-ups (migration `0045_payment_review_followups.sql`):

- The Checkout idempotency key is `patchwork-checkout-<checkout>-<parameter hash>`, so a retry with changed parameters (a customer recorded meanwhile) gets a new Session instead of an idempotency error.
- A customer deleted, or a monthly Price archived, in an organization's Dashboard is dropped and the Checkout retried once. A replacement Price gets its own idempotency key.
- A monthly Checkout that completes after its donor deactivated gets the same cancel-at-period-end command as the donor's other gifts.
- The eligibility sweep uses a pause key that changes with the subscription row, so a pause after the organization resumed collection is not replayed by Stripe. It checks that collection is paused, replaces a `donor` pause reason written by its own pause webhook, and moves gifts that keep failing behind the rest.
- An expired, revoked or unknown session answers 401 `SESSION_EXPIRED` instead of 500 on every authenticated and optional-auth route.
