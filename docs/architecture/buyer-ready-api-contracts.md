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
