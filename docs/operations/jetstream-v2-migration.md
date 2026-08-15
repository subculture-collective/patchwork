# Jetstream v2 shadow migration

Patchwork keeps the current v1 projection live while v2 rebuilds an isolated
copy. Do not point the live worker at v2 or reuse its checkpoint.

## Cursor and storage boundary

- v1 checkpoints use `jetstream-v1-time-us` and contain Unix-microsecond
  `time_us` values.
- v2 checkpoints use `jetstream-v2-seq` and contain network sequence values.
- v2 records, tombstones, identity state, account state, sync work, and
  projection freshness live in the `jetstream_v2_shadow` schema.
- The indexer refuses the unsafe combinations `v2 + live` and
  `v1 + v2-shadow`.

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
replay without it; the v1 worker neither requires nor receives this key.

## Start a rebuild

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
`INDEXER_V2_URL`.

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

## Cutover gate

This change intentionally does not automate cutover. Before a separate atomic
cutover change is authorized, require all of the following:

1. The v2 replay has reached the live tail and the worker remains ready.
2. URI and current-CID comparisons are clean or every exception is explained.
3. Pending/failed repository reconciliation work is zero.
4. Account deletion and identity-cache behavior has been exercised locally or
   in an isolated environment.
5. The v1 worker, `jetstream-v1-time-us` checkpoint, and public projection
   tables remain intact until the v2 projection has been accepted.

Cutover must change readers and the active writer together under a database
lock or equivalent deployment transaction. Do not rename/drop the v1 tables
or delete its checkpoint until the v2 projection has been accepted. Because
Patchwork is not currently serving public traffic, no time-based soak period is
required.
