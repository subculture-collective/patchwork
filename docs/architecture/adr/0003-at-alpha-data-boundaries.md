# ADR 0003: AT alpha data boundaries and ingestion source

- Status: Accepted
- Date: 2026-07-10
- Owners: Patchwork engineering and trust-and-safety
- Supersedes: data-placement assumptions in the phase plans where they conflict with this decision
- Amended: 2026-07-28 for the buyer-ready responsive-web target
- Reconciled: 2026-09-20 with implemented chat, ZIP publication and transient travel; remaining acceptance is tracked in [current acceptance](../../current-acceptance.md)

## Context

The original decision separated five AT record schemas and application workflows. The implemented runtime now has real persistence and provider paths, whose qualification is tracked separately. The governing data boundaries remain:

1. public, user-owned AT repository records;
2. rebuildable Patchwork read projections;
3. private operational state that must never be published to AT repositories; and
4. transient inputs that should not be retained.

AT repository records are public, portable user data. They are not an appropriate store for secrets, exact service locations, blocks, private reports, moderation evidence, operator notes, OAuth tokens, or internal authorization decisions. Conversely, PostgreSQL projections must not become the authority for user-owned public records.

The alpha also needs an ingestion source. The protocol firehose provides self-certifying repository events with CBOR/CAR decoding and sequence cursors. Jetstream provides simpler JSON record events and collection filtering, but is not a formal AT Protocol component and does not replace repository backfill or verification.

## Decision

### 2026-07-28 buyer-ready amendment

This amendment supersedes the earlier exact-location retention allowance and
the earlier statement that only aid posts may be written by the runtime. Aid
posts, directory resources, and volunteer profiles may use their official
user-owned AT collections once each collection has its complete authenticated
CRUD, ingestion, projection, deletion, and moderation path. Reports,
verification evidence, approvals, offers, connections, inbox state,
notifications, attachments, consent, and organization membership remain
private PostgreSQL or private-object-store state. Bounded text chat is now
implemented as private PostgreSQL state for authorized connection participants
and group members; it does not enable public conversation lexicon writes.

Personal exact location is transient input. Patchwork must never persist it in
PostgreSQL, AT records, object storage, logs, analytics, notifications,
exports, backups, Playwright artifacts, or any fallback transport. It may be
sent for peer exchange only over an authenticated encrypted WebRTC data channel between the two
participants of an accepted active connection. Signaling is authenticated and
authorized against that connection, requires fresh consent from both
participants, uses a short-lived single-use identifier, contains no
coordinates, fails closed, and is disabled by expiry, block, disconnect,
deactivation, authorization loss, or maintenance mode. General telemetry must
redact both coordinates and signaling identifiers.

An exact public address is a directory-only exception. It is allowed only for
a public organization or public resource with active verification and a
separate, active moderator approval. The approval expires and is revocable.
Confidential facilities, private residences, personal meetup points, stale
verification, and forged approval state are never eligible. Revocation or
expiry immediately removes the exact projection and falls back to an approved
approximate service area or quarantines the listing. Approval and origin
metadata are immutable server-controlled state; browser and AT payloads cannot
grant them.

### Transient travel exception

An explicitly requested travel plan may send a precise origin in a non-cacheable
POST body through the API to the self-hosted OTP router. The origin exists only
in bounded request memory, never in database/object storage, public AT records,
URLs, logs, exports, notifications, backups or retained test artifacts. This is
separate from peer-location signaling and does not relax its consent rules.
The destination is resolved from an eligible public resource address. Requests
have bounded time/concurrency and cancellation; responses omit coordinate
geometry. Chicago application routing and the initial observation are recorded
as active; a real-device permission journey and sustained natural maintenance
remain open in the acceptance matrix.

### 1. Approved public collections

The original alpha write collection was:

- `app.patchwork.aid.post`

The signed-in user’s repository is authoritative for the public aid-post document and its public status. Patchwork writes through the user-authorized PDS session and stores the returned AT URI, CID, repository revision where available, and collection in private command/audit metadata.

The buyer-ready program additionally authorizes complete runtime paths for:

- `app.patchwork.volunteer.profile`
- `app.patchwork.directory.resource`

The following existing lexicons remain prohibited runtime writes:

- `app.patchwork.conversation.meta`
- `app.patchwork.moderation.report`

Their schemas and tests remain design inputs. Re-enabling any collection requires a separate ADR covering public-data risk, ownership, deletion, moderation, and interoperability.

In particular, reports and moderation casework are private. The presence of `app.patchwork.moderation.report` in the repository does not authorize publishing reporter identity, report details, evidence, or case outcomes.

### 2. Public aid-post record

New version 2 posts publish only a supported US `countryCode` and `postalCode`
for location. The original coarse-coordinate rules below apply to legacy
version 1 compatibility, not to new request publication. Records without a
confirmed ZIP have no public discovery coordinates. The current wire contract
is described in [postal geography](../postal-geography.md).

An aid-post record may contain only information the author has explicitly agreed to publish:

- title and description;
- category and urgency;
- public status: `open`, `in-progress`, `resolved`, or `closed`;
- coarse area label;
- a quantized public map point or coarse region identifier;
- `precisionKm`, which must be at least `1` for the alpha;
- creation and update timestamps.

An aid-post record must not contain:

- exact latitude/longitude or street address;
- phone number, email address, private chat content, or access instructions;
- requester legal name unless deliberately included in public prose by the requester;
- volunteer assignment, triage notes, report state, block state, verification evidence, or moderation decisions;
- OAuth tokens, session identifiers, internal account IDs, IP addresses, or device identifiers.

The API must derive the author DID from the authenticated session. It must reject author, owner, or repository identity supplied as a command parameter when that value could override the authenticated principal.

### 3. Rebuildable PostgreSQL projection

The indexer owns a durable read projection of public aid-post records. The projection is a cache/read model, not the record authority.

It may store:

- AT URI, collection, CID/revision, and source cursor;
- author DID required for ownership and reconciliation;
- validated public record fields;
- quantized public geography and derived search/ranking fields;
- ingestion, validation, and projection timestamps;
- public deletion state long enough to prevent stale resurrection during replay.

Public query responses may expose the AT URI and public author identity when required by the product, but application logs and metrics must use redacted or hashed references. Exact coordinates are forbidden in the projection even if an upstream payload is malformed and supplies them.

The entire projection must be reproducible from repository state plus the approved stream/backfill process. Operator edits to projection rows are prohibited except for documented repair tooling that subsequently reconciles against repository authority.

### 4. Private PostgreSQL operational state

Patchwork is authoritative for private application workflow state. Separate access-controlled tables store:

- encrypted OAuth session and state material;
- command idempotency keys and upstream write results;
- minimal lifecycle state and append-only transition audit;
- block relationships;
- reports, moderation cases, evidence references, decisions, and appeals;
- rate-limit and abuse-control state that must survive restarts;
- private operator notes;
- exact-location signaling grants containing no coordinates.

Private state is never emitted to the AT repository or public discovery API. Access is least-privilege and auditable. Application metrics contain aggregates, not raw private fields.

Exact personal coordinates are never PostgreSQL operational state. The server
may retain only an audited authorization decision and short-lived signaling
state without coordinates. That state expires within the signaling window and
is revoked immediately when the connection becomes unauthorized.

OAuth access and refresh material follows the selected official client’s storage requirements, is encrypted at rest, never logged, never returned to browser JavaScript, and is deleted on logout/account disconnection after any required revocation attempt.

### 5. Lifecycle ownership and synchronization

The AT record’s public status and the private workflow state have different responsibilities.

| Private workflow state | Public AT status | Write behavior |
| --- | --- | --- |
| `open` | `open` | Author creates the record. |
| `triaged` | `open` | Private transition only. |
| `assigned` | `in-progress` | Author-authorized command updates the AT record after assignment is accepted. |
| `in_progress` | `in-progress` | Private transition; no additional public write. |
| `resolved` | `resolved` | Author-authorized command updates the AT record. |
| `archived` | `closed` | Author-authorized command closes the public record, or local archival follows an already closed record. |

The indexer treats repository status as authoritative for public discovery. A stream event that changes public status updates the projection and triggers reconciliation of compatible private workflow state.

Moderators and operators cannot silently mutate a user repository. A moderation decision changes Patchwork visibility and case state. A user-owned AT record remains in the repository unless the user deletes it or an authorized AT infrastructure actor applies a separate protocol-level action.

When an author’s PDS write fails, the private transition must not claim that the public status changed. Commands are retriable with an idempotency key, and the UI must distinguish local workflow state from pending or failed public synchronization.

### 6. Delete and tombstone semantics

Deletion authority is the absence/deletion of the record in the user repository, observed through a repository event or confirmed repository read.

Deletion flow:

1. The author requests deletion through an authenticated command, or deletes through another AT client.
2. The PDS accepts the repository deletion and returns success/revision information.
3. Ingestion observes the delete operation. Direct API confirmation may hide the record immediately while stream confirmation is pending.
4. The public projection removes the record from map, feed, directory, ranking, search, and caches.
5. Patchwork retains only the minimum private deletion audit required for idempotency, abuse investigation, and legal policy. It must not retain the deleted public body in the active projection.
6. Exact-location details and other fulfillment secrets are queued for immediate deletion.
7. Replay cannot resurrect a deleted record unless repository authority contains a later valid create with a new repository revision and the product explicitly permits recreation.

`app.patchwork.system.tombstone` is an internal normalized event shape used by local domain tests. It is not an AT record written to the user repository and is not the source of deletion authority.

Account deletion or deactivation is handled separately: the indexer removes affected public projections according to account status/repository availability, and private data follows the retention and legal policy rather than being made public.

### 7. Geoprivacy enforcement

Geoprivacy is enforced at every boundary:

- The web labels public location as approximate before submission.
- The command API rejects public `precisionKm < 1` and quantizes coordinates before a repository write.
- Exact personal inputs use a transient peer-exchange or travel-request payload
  and never share a type with a public record or server signaling payload.
- The lexicon validator enforces the alpha public minimum.
- The indexer rejects or quarantines records that violate the public location policy.
- Query APIs return only quantized/coarse geography.
- Logs, traces, error payloads, analytics, screenshots, and test artifacts redact exact location.
- Backups and exports contain no personal exact-location coordinate because the
  server never persists one.

### 8. Jetstream is the alpha live-ingestion source

The alpha uses Jetstream for live changes because its JSON encoding and collection filtering materially reduce implementation and operating complexity for one small collection. The consumer filters for `app.patchwork.aid.post` and persists its cursor.

This choice has explicit limits:

- Jetstream is not the record authority and is not a formal protocol component.
- A received event must pass lexicon validation and repository identity/ownership checks appropriate to the risk.
- Startup and repair require a repository/PDS backfill or reconciliation mechanism; Jetstream alone is insufficient for historical completeness.
- Cursor age, disconnect duration, validation failures, and projection freshness are monitored.
- The event-source interface remains provider-neutral so `com.atproto.sync.subscribeRepos` can replace Jetstream without changing projection-domain code.

The full protocol firehose is deferred until one of these conditions is measured:

- Jetstream reliability or retention cannot satisfy the alpha recovery objective;
- self-certifying commit verification is required for the threat model;
- full repository/account/identity events are required;
- collection volume or provider dependency justifies operating the CBOR/CAR pipeline.

## Consequences

### Positive

- Users retain authority over public aid posts.
- Sensitive coordination and trust-and-safety data cannot leak through public repositories by design.
- The read model can be rebuilt and repaired without becoming a second record authority.
- The alpha integration remains narrow enough to complete and operate.
- The stream implementation can begin with filtered JSON while preserving a migration boundary to the protocol firehose.

### Costs and risks

- Public and private lifecycle state require explicit reconciliation and visible partial-failure handling.
- Jetstream adds provider and non-protocol dependency risk.
    - Exact-location fulfillment requires browser memory clearing, authenticated
      WebRTC authorization, revocation, and cross-system absence proofs.
- Deferred lexicons cannot be presented as current product capabilities.
- A user may edit an aid post from another client, so Patchwork must accept externally originated valid changes.

## Compliance checks

A change violates this ADR if it:

- writes any deferred Patchwork collection during the alpha;
- stores exact coordinates in an AT record or public projection;
- persists a personal exact coordinate in any server, observability, export,
  backup, notification, or test-artifact system;
- accepts browser-supplied origin, verification, or exact-address approval;
- exposes an exact public-resource address without active verification,
  separate active moderator approval, and a non-confidential classification;
- publishes reports, blocks, evidence, casework, tokens, or operator notes;
- treats a PostgreSQL projection row or internal tombstone as record authority;
- lets a moderator mutate a user repository without separate explicit authority;
- treats Jetstream as a complete historical source without reconciliation;
- logs unredacted tokens, exact locations, or private report content.

## References

- AT Protocol, “Streaming Data”: https://atproto.com/guides/streaming-data
- AT Protocol, “Sync”: https://atproto.com/specs/sync
- Bluesky, “Introducing Jetstream”: https://docs.bsky.app/blog/jetstream
- `docs/at-protocol/lexicon-versioning.md`
- `docs/at-protocol/tombstone-contract.md`
- `packages/shared/src/privacy.ts`
