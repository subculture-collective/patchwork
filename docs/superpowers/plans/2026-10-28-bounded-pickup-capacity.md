# Bounded pickup capacity — issue #132

Date: 2026-10-28

Scope: one pickup with requester-approved helper places. Existing connection
scheduling and private outcome feedback remain the authority for each helper.
No recurrence, new ratings, or live-provider qualification is included.

## Implementation sequence

1. Add migration `0038_bounded_pickup_capacity.sql`. Existing workflows receive
   capacity 1 and `pickup_configured=false`; their assignments and handoffs are
   preserved. Database triggers serialize admission and reject excess places,
   duplicate committed helpers, invalid capacity reductions, and closure with
   active arrangements. Pickup mode cannot be disabled after opt-in.
2. Extend `CoordinationService` and its authenticated HTTP handler with
   requester-only capacity/closure commands. Lock parent workflows before
   child offers/connections, including expiry sweeps. Keep pending offers at
   capacity, replay existing commitments, and complete only the chosen helper.
   Completed places remain occupied; cancellation and expiry free places.
3. Keep private schedules and feedback scoped to each connection. Retain
   scheduling conflicts, block/deactivation/moderation checks, expiry, and
   retention. Include pickup configuration in account exports. Reject the
   legacy assignment command for configured pickups.
4. Add inbox capacity/closure controls with English and Spanish copy, bounded
   number input, committed/active counts, pending-action disabling, and hidden
   controls when the coordination read fails. Helpers see their own connection
   only. Closure stays disabled while an arrangement is active.
5. Verify migration preservation, competing final-place acceptance, retries,
   cancellation/replacement, completed-place occupancy, partial completion,
   private arrangements/feedback, scheduling conflicts, export, expiry, and
   the requester/two-helper browser journey. Publish a PR that closes #132 on
   merge, with local and hosted results recorded separately.

## Executable checks

- `npm run typecheck`
- `npm run test:coverage`
- `npm run test:integration`
- `npm run test:integration -- services/api/src/coordination-service.postgres.test.ts`
- `npm run test:e2e -w @patchwork/web`
- `npm run test:operations`
- `npm run test:maps`
- `npm run test:exact-location-absence`
- `npm run test:e2e:redact`

The browser journey uses mocked HTTP responses for three separate browser
contexts; PostgreSQL tests verify the real persistence and concurrency paths.
These checks do not establish a credentialed live provider journey, deployment,
or operational readiness.

## Compatibility and rollback

The migration is additive. Old records retain their previous lifecycle until
explicit opt-in. Keep the schema when reverting application code; do not drop
capacity fields or guards after pickup data exists. An older application does
not implement pickup semantics, so pause pickup mutations and retain the new
application version for existing configured pickups until a reviewed recovery
or forward fix is ready. Back up before applying this migration to a shared
runtime. No shared-runtime migration is performed by this change.
