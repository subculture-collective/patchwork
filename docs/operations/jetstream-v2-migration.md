# Jetstream v2 migration

Patchwork uses Jetstream v2 in `v2-live` mode for the public projection. The
v1 projection and its checkpoint remain in rollback storage. Do not reuse a v1
checkpoint for v2 or run the shadow worker with the live worker.

## Cursor and storage boundary

- v1 checkpoints use `jetstream-v1-time-us` and contain Unix-microsecond
  `time_us` values.
- v2 checkpoints use `jetstream-v2-seq` and contain network sequence values.
- During a shadow rebuild, v2 records, tombstones, identity state, account
  state, sync work, and projection freshness live in the
  `jetstream_v2_shadow` schema.
- Before cutover, v2 writes only in `v2-shadow` mode. After the atomic
  promotion, `v2-live` writes the public projection. The indexer accepts only
  `v1` with `live`, or `v2` with `v2-shadow` or `v2-live`.

The first v2 run pins a live network sequence, snapshots only Patchwork commits
from sequence zero, then snapshots identity/account/sync history only for DIDs
discovered in those commits. It saves `jetstream-v2-seq` only after both bounded
phases complete. The normal worker then calls `replay()` from that checkpoint
for the small cutover gap and seamless realtime handoff. This avoids downloading
network-wide control history while preserving account deletion, repository sync,
and identity semantics for Patchwork participants. Commit records still pass
through Patchwork's `@patchwork/at-lexicons` and Zod normalization boundary.

Bluesky-hosted v2 replay combines an unauthenticated live WebSocket with
metered HTTP archive requests. Create an API key at
`https://bsky.network/account#api-keys-section-heading` and inject it only as
the `JETSTREAM_API_KEY` deployment secret. Patchwork refuses to start a v2
replay without it. The live v2 worker also requires this key.

## Rebuild a shadow projection

Apply the API and indexer migrations, run the bounded backfill, then explicitly
enable the shadow profile:

```sh
docker compose --profile jetstream-v2-shadow up -d \
  patchwork-api-migrations patchwork-indexer-migrations
docker compose --profile jetstream-v2-shadow run --rm patchwork-v2-backfill
docker compose --profile jetstream-v2-shadow up -d patchwork-v2-shadow
```

The profile is opt-in and does not replace `patchwork-spool`. Set
`JETSTREAM_API_KEY` before starting it. The SDK service origin defaults to
`https://jetstream.us-east.bsky.network` and may be overridden with
`INDEXER_V2_URL`. The live worker requires `JETSTREAM_API_KEY` too.

## Compare projections

Query the shadow worker's internal comparison endpoint:

```sh
docker compose exec patchwork-v2-shadow \
  wget -qO- http://127.0.0.1:4101/migration/v2/compare
```

For each Patchwork collection, the response reports live and shadow counts,
URIs missing from either side, and current-CID mismatches. Investigate every
difference; do not treat equal counts alone as equivalence.

Also inspect `jetstream_v2_shadow.indexer_repo_reconciliation_queue`. A sync
event is a durable reconciliation trigger, not proof that repository
reconciliation has completed.

## Historical cutover gate

The v2 cutover completed in `caaef1e`. Use these checks before any future
cutover or rollback rehearsal:

1. The v2 replay has reached the live tail and the worker remains ready.
2. URI and current-CID comparisons are clean or every exception is explained.
3. Pending/failed repository reconciliation work is zero.
4. Account deletion and identity-cache behavior has been exercised locally or
   in an isolated environment.
5. The v1 worker and v2 shadow worker are both stopped at their durable
   checkpoints.

The SQL cutover copied the public projection into the `jetstream_v1_rollback`
schema, replaced the public projection and control tables from
`jetstream_v2_shadow` in one transaction, and retained
`jetstream-v1-time-us`. `patchwork-spool` now starts with
`INDEXER_JETSTREAM_VERSION=v2` and `INDEXER_PROJECTION_MODE=v2-live`. Leave the
shadow worker stopped unless you run a new comparison. This repository has no
fresh protected-staging or live-PDS v2 evidence, so the cutover does not change
the public-launch `NO-GO` decision.
