# Patchwork service boundaries

Updated: 2026-07-28

ADR 0003 governs data placement. These are implemented buyer-ready boundaries,
not evidence of public-launch approval.

## `apps/web`

- Uses the API for OAuth, session-derived commands, discovery, private
  workflows, account controls, and moderator controls.
- Never receives OAuth refresh material and never accepts a DID/role/origin as
  browser authority.
- Holds exact personal coordinates only in bounded memory for a mutually
  authorized encrypted peer exchange or an explicitly requested transient
  travel plan. The travel API/router exception is described in ADR 0003.
- Shows loading, empty, error/retry, stale retained-data, offline, and
  maintenance states. Offline mutations are not queued.
- Has no fixture fallback in a production build. Bounded text chat is available
  only to active connection participants or authorized room members; real-provider
  lifecycle qualification is separate from implementation.

## `services/api`

- Terminates HTTP authentication, authorization, CSRF, idempotency, input
  limits, consent, pre-publication safety, and maintenance boundaries.
- Writes public aid, directory, and volunteer records through the official AT
  client to the user's PDS; it does not treat PostgreSQL as public-record
  authority.
- Owns private lifecycle, organizations, verification/appeals,
  exact-public-address approvals, offers/connections/inbox/outcomes,
  attachment metadata/jobs, notification outbox, maintenance, and account
  privacy state.
- Authorizes coordinate-free, short-lived exact-location signaling; it has no
  coordinate field or persisted fallback.
- Owns private scheduling, group membership and bounded text chat.
- Handles transient travel planning through the self-hosted router; it neither
  stores the origin nor returns coordinate geometry to the browser.
- Exposes only safe moderator previews and short-lived clean-object access.

## `services/indexer`

- Consumes the three supported public record families from Jetstream through a
  provider-neutral event-source adapter.
- Validates lexicons/geoprivacy and transactionally stores projections,
  tombstones, dead letters, reconciliation, freshness, and cursor progress.
- Defaults live projections to `visitor-created`; only the privileged
  deterministic showcase seed can assign `synthetic`.
- Does not own sessions, private workflows, moderation decisions, attachment
  bytes, or exact personal location.

## `services/moderation-worker`

- Claims durable work with leases, idempotent decisions, and bounded retries.
- Runs replaceable fail-closed submission checks and stores hashes, stable
  reason codes, and evidence-safe previews rather than raw submissions.
- Owns private queue/review/audit/appeal and urgent-notification event state.
- Changes Patchwork visibility, not user repository records.

## `packages/at-client`, `packages/at-lexicons`, and `packages/shared`

- `at-client` wraps official OAuth/repository clients and returns
  Patchwork-owned result/error types.
- `at-lexicons` holds strict canonical public record definitions and the
  integer microdegree/metre wire codec.
- `shared` owns transport-neutral contracts, validation, privacy/redaction,
  authorization capability names, ranking, and configuration schemas.
- None of these packages owns database connections, browser state, or product
  operator authority.

## Storage ownership

| Data | Writer | Reader |
| --- | --- | --- |
| OAuth/browser sessions, consent, preferences | API | API only |
| Public AT records | User PDS through API commands | Federation/indexer and AT clients |
| Public projections, cursor, tombstones | Indexer (showcase seed only for labeled demo records) | API |
| Organizations, verification, coordination, inbox, outcomes | API | API and narrowly authorized moderator paths |
| Exact personal coordinate | Browser memory only; no persistent writer | Authorized peer through encrypted exchange, or API/router transiently for an explicitly requested travel plan |
| Exact public-resource approval | API/moderator workflow | API discovery query |
| Attachment bytes | API/worker through private object store | API-issued clean-object access only |
| Attachment metadata/jobs | API/worker | Owner and authorized moderator/API workers |
| Notification intents/attempts | API triggers and notification worker | Recipient/API and authorized operators |
| Moderation queue/reviews/audit | API enqueue and moderation worker | Moderation worker and capability-gated console |
| Showcase provenance | Privileged deterministic seed; live origin defaults are server-set | Discovery, moderation, export, refresh/deletion logic |

One PostgreSQL cluster may host these table groups, but production roles must
not gain cross-service write access merely because storage is co-located.

## Cross-service failure rules

- Public PDS writes and private workflow changes expose explicit partial-sync
  state; a local success never invents downstream success.
- Repository delivery is asynchronous, replayable, and reconciled against
  repository authority.
- Moderation and notification work is durable before processing.
- Required safety, storage, signaling, or provider checks fail closed.
- Declared privacy, authorization, abuse, integrity, backlog, monitoring, or
  backup failures put new submissions and exact exchange into read-only mode.
- Fixture construction is permitted only in explicit local/test mode and is
  rejected by production builds.

## Deferred topology

Chat, scheduling and groups run inside the API; there are no separate deployed
services for these domains. Native clients, offline writes, external partner
exchange, reputation and multi-region topology remain deferred or exploratory.
The deployed OTP router is a travel service, not a multi-region application
router. The [roadmap](https://git.subcult.tv/subculture-collective/patchwork/issues/10)
and [current acceptance](../current-acceptance.md) distinguish these boundaries.
