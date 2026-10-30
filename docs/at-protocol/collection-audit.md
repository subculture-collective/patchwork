# Public collection audit

Audited: 2026-10-30, canonical `main`. Issue
[#73](https://git.subcult.tv/subculture-collective/patchwork/issues/73),
first acceptance criterion. This is a source audit, not a live repository or
provider check.

## Collections against ADR 0003

[ADR 0003](../architecture/adr/0003-at-alpha-data-boundaries.md) permits
runtime writes for three collections and prohibits two.

| Collection | ADR 0003 | Lexicon | API write path | Indexer subscription | Projection and deletion |
| --- | --- | --- | --- | --- | --- |
| `app.patchwork.aid.post` | Permitted | Yes | `records/aid-post-command-service.ts` through `record-client.ts` | v1 live, v2 backfill and v2 shadow/live | Projected; deletes and tombstones; private lifecycle reconciled |
| `app.patchwork.directory.resource` | Permitted | Yes | `records/directory-resource-command-service.ts` through `directory-record-client.ts` | v1 live, v2 backfill and v2 shadow/live | Projected; deletes and tombstones |
| `app.patchwork.volunteer.profile` | Permitted | Yes | `records/volunteer-profile-command-service.ts` through `volunteer-profile-record-client.ts` | v1 live, v2 backfill and v2 shadow/live | Projected; deletes and tombstones |
| `app.patchwork.conversation.meta` | Prohibited | Yes (design input) | None | Not requested | Projection store refuses it |
| `app.patchwork.moderation.report` | Prohibited | Yes (design input) | None | Not requested | Projection store refuses it |

Write side:

- Each AT client pins a single collection constant and rejects AT URIs for any
  other collection. No client accepts a caller-supplied collection.
- `packages/shared/src/messaging.ts` can build `conversation.meta` records, but
  no service or app imports it. Chat and reports stay in the application
  database, as ADR 0003 requires.

Only aid posts have private lifecycle state, so the lifecycle reconciler
handling only that collection is expected.

## Gap found and fixed

The v1 Jetstream source dropped commits for unsubscribed collections on the
client side, but the v2 replay source and v2 backfill relied only on the
server-side collection filter. The shared normalizer accepts all five
Patchwork NSIDs, so a prohibited commit returned by the server would reach
the projection store. That store throws, the batch is not checkpointed, and
the v2 path would stop at that event.

Both v2 paths now skip commits outside the requested collections. The live
source counts them as malformed frames and advances its cursor, matching v1;
the backfill does not count them or treat their authors as relevant DIDs.
`jetstream-v2-source.test.ts` and `v2-backfill.test.ts` cover this.

## Ingestion source triggers

ADR 0003 §8 defers the full `com.atproto.sync.subscribeRepos` firehose until a
trigger is measured. Status on 2026-10-30:

| Trigger | Status |
| --- | --- |
| Jetstream reliability or retention cannot meet the recovery objective | Not measured. The v2 path backfills from sequence zero through the archive, which addresses retention for rebuilds. Reliability needs live operation under #15. |
| Self-certifying commit verification required by the threat model | Not required by the current threat model. Records are validated against lexicons and repository identity. |
| Full repository/account/identity events required | The v2 path already consumes identity, account and sync events for DIDs that authored Patchwork commits, without the CBOR/CAR pipeline. |
| Collection volume or provider dependency | Three small collections; no measured volume. Provider dependency is the v2 API key and Bluesky-hosted archive. |

No trigger is currently met. Jetstream, with v2 replay for rebuilds, remains
the ingestion source. The second and third #73 criteria need live operating
evidence and stay open.
