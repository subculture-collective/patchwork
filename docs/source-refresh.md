# Source refresh

The first implementation unit is a read-only catalog comparison. It reads live
listing state in a repeatable-read, read-only PostgreSQL transaction and compares
a candidate catalog with each listing's latest applied source evidence, using the
original imported snapshot until such evidence exists. It does not
fetch sources, write changes, renew evidence, or schedule jobs.

From the repository root, with `API_DATABASE_URL` configured for the intended
database:

```sh
npm run resources:refresh:preview -w @patchwork/api -- /absolute/path/catalog.json
```

The file uses the same strict catalog schema as the existing resource importer.
Output is JSON with a candidate catalog hash, generation timestamp, counts,
before/after values, evidence, and base listing/profile revisions. Unknown flags,
including `--apply`, are rejected. A source hash supplied in a catalog is metadata;
this command does not independently verify it against downloaded source bytes.

Only contact changes can receive `contact-automation-candidate`: phone values
must contain 7–15 digits with ordinary telephone punctuation, and changed website
URLs must use HTTPS on the same hostname without credentials. This classification
is a proposal for later verified execution, not approval to publish. Newer source
evidence is required for changed content; future or expired retrieval dates fail
the policy. These format checks do not establish that a phone number or URL works.

Claims, service profiles, pending corrections, withdrawn listings, changed source
identity, divergent current contact details, contact removals, and all non-contact
changes require review. A missing row in a represented source produces a review
signal, never an automatic closure. Omitted sources are outside the comparison.
An unchanged retrieval does not renew source or provider evidence. Original source
snapshots, source expiry, profile history, and public projections remain untouched.

## Chicago Public Library publisher adapter

The first source adapter targets the pinned City of Chicago dataset
`x8fc-8rcq`. It requests at most 500 rows, sorts normalized branches by their
stable publisher IDs, rejects
redirects and non-JSON responses, caps the raw response at 1 MB, and requires a
complete feed of 75–100 unique branches. When a baseline is supplied, at least
90% of its identifiers must remain; a smaller feed fails before any artifact is
written.

```sh
npm run resources:refresh:cpl -w @patchwork/api -- /absolute/evidence/directory
```

The adapter validates branch identity from an official `chipublib.org/locations/`
URL, Chicago locality and coordinate bounds, Cook County assignment, ZIP and
phone formats, and the shared catalog schema. Unknown publisher fields survive
only in the exact raw response. The derived catalog carries publisher hours as
display text; it does not convert that text to qualified schedules or infer
eligibility, accessibility, closures, or services.

Artifacts are written only after every row validates:

- `raw/<sha256>.json` is the exact response body and is immutable by content hash.
- `runs/<timestamp>-<sha-prefix>.manifest.json` records the request/response URL,
  retrieval time, content type, ETag, Last-Modified value, byte and row counts,
  and raw/normalized hashes.
- `runs/<timestamp>-<sha-prefix>.catalog.json` is the strictly validated derived
  source catalog for the read-only refresh preview.

Reusing an artifact path succeeds only when its bytes match exactly. HTTP errors,
timeouts, redirects, malformed or oversized bytes, partial feeds, duplicate IDs,
invalid normalized values, and schema failures retain no run artifacts. The
evidence directory is operational state and must stay outside the source tree.

## Persistent candidates and contact application

Migration `0036_source_refresh_candidates.sql` adds append-only source runs and
candidate state. It changes no existing table and requires no backfill. Runs are
deduplicated by source ID and exact raw SHA-256; replaying identical evidence
returns the original run instead of creating duplicate work. Unchanged rows are
retained in the run preview but do not create queue entries.

After producing a read-only preview, persist it with its retained manifest:

```sh
npm run resources:refresh:persist -w @patchwork/api -- \
  cpl /absolute/run.manifest.json /absolute/preview.json
```

Only a candidate already classified as `contact-automation-candidate` can use
the guarded application command:

```sh
npm run resources:refresh:apply-contact -w @patchwork/api -- \
  --candidate=00000000-0000-0000-0000-000000000000 --apply
```

Application runs in one transaction and locks the candidate and resource. It
rechecks the source/raw hash, changed-field set, import origin, listed and claim
state, listing and projection timestamps, canonical source snapshot hash,
service-profile revision, pending corrections, and current contact baseline.
Only `phone` and same-host HTTPS `website` candidates can reach this point. A
failed guard rolls back and leaves the candidate pending. A successful update
changes only projection contact data, appends a public-resource audit event,
marks the candidate applied, and supersedes older pending contact candidates for
the resource.

The original `public_resource_listings.source_snapshot` remains immutable.
Subsequent previews use the most recent applied candidate as source evidence, so
later publisher changes compare against the last applied evidence without
silently renewing the initial snapshot. Review, new-listing and missing-feed
candidates have no automatic apply path.

The moderator console lists pending and resolved candidates through the
reviewer-only `/admin/source-refresh/candidates` API. It shows the retained
publisher URL and hash, retrieval time, classification reasons, changed fields,
and normalized before/after values. Reviewers may apply contact-only candidates
through the same transaction guards or dismiss a current candidate with a
reason and exact revision timestamp. Reviewers who are active members of the
organization claiming a listing cannot decide its candidate. A newly persisted
candidate atomically supersedes older pending candidates for the same resource.

## Bounded orchestration

The end-to-end command fetches and retains CPL evidence, computes a read-only
preview, and persists the resulting review queue. It never applies a listing
change:

```sh
npm run resources:refresh:cpl-run -w @patchwork/api -- \
  /absolute/evidence/directory
```

`API_DATABASE_URL` is required. A PostgreSQL advisory lock permits one CPL run
at a time; a concurrent invocation exits successfully with
`skipped-concurrent` before contacting the publisher. HTTP 429 and 5xx responses,
timeouts, and network failures receive at most three attempts with bounded
backoff. Publisher-contract, normalization, partial-feed, and evidence failures
are not retried. Evidence is written only after the entire publisher response
validates, and candidate persistence remains transactional and replay-safe.

The NUC deployment runs this command through the enabled
`patchwork-source-refresh.timer` after deployment of the signed API image and
its database migrations. The API container supplies the intended
database connection and `/srv/patchwork-public/source-refresh` is bind-mounted
at `/var/lib/patchwork/source-refresh`. The wrapper refuses to run at 2 GiB but
does not delete evidence. It records last-attempt and last-success timestamps in
`source_refresh_operational_status`; Prometheus alerts on a failed attempt or no
completed refresh for 36 hours. The timer runs daily at 03:15 America/Chicago
with up to 30 minutes of jitter. Patrick Fanella is the named responder.

Rollback is code-first: stop invoking the persist/apply commands and revert the
application code. The additive tables can remain without affecting older code.
Dropping them is optional and should happen only after their evidence has been
archived; no existing application columns or rows need reversal.

## Remaining implementation sequence

1. Ingest verified Chicago service assertions with source, review state, timezone,
   confirmation date and expiry. Cover unknown, contradictory and expired evidence,
   overnight hours, closures and eligibility rules. Demonstrate useful coverage
   before claiming hours/eligibility filtering is qualified.
2. Qualify real OAuth, PDS, mail and push provider journeys separately with
   disposable identities. Travel is active through the pinned OTP 2.10.0
   runtime: Chicago walk, CTA bus and rail, wheelchair, arrive-by,
   outside-graph, client-disconnect and eight-request concurrency checks passed.
   The signed API returned real Access Living and Chicago Tool Library
   itineraries, and its initial 15-minute post-activation window retained
   API/router availability with zero route errors.

Verification: the source-refresh unit suite owns classification, input
preservation and bounded retries; the PostgreSQL suite owns live-state joins,
concurrency, correction conflicts, reviewer decisions, supersession, transaction
cleanup and persisted-row preservation. The browser journey owns evidence
inspection and the reviewer commands. Run `npm run check`,
`npm run test:integration`, and the source-refresh reviewer browser scenario.
The activated NUC timer has completed a successful live publisher retrieval,
replay-safe persistence and operational heartbeat. These checks still do not
establish Chicago structured service coverage or unrelated live-provider
qualification.


## Registered source jobs

`source-registry.ts` is the reviewed runtime allowlist, separate from the
[publisher inventory](./data/source-onboarding.md). Only CPL has a qualified
runtime adapter at present. The other 129 inventory identities are not enabled
by their presence in the catalog. Each definition records adapter version,
owner, cadence, geography, complete-feed bounds and bounded retry policy.
Adapter/version metadata is attached to persisted run evidence; retained raw
publisher artifacts remain unchanged. Old manifests remain readable.

```sh
npm run resources:refresh:run -w @patchwork/api -- --list
npm run resources:refresh:run -w @patchwork/api -- --source=cpl --output=/absolute/evidence --mode=preview
npm run resources:refresh:run -w @patchwork/api -- --source=cpl --output=/absolute/evidence --mode=persist
```

Preview retains validated evidence and computes database comparisons but writes
neither candidate state nor operational success. Persist writes review
candidates, never listing changes. The original `resources:refresh:cpl-run`
command remains compatible and uses the same job lock and heartbeat path.

Set `PATCHWORK_SOURCE_REFRESH_PAUSED=cpl` in the executing API container's
environment to pause the job without fetching or writing a success heartbeat.
Unknown pause IDs fail rather than silently ignore a typo. This is an operator
kill switch, not permission to enable arbitrary publishers. The existing
systemd cadence remains authoritative; registering a source does not install a
schedule. New sources require an explicit adapter, reviewed access contract,
source-specific validation, schedule and monitoring qualification.

Jobs lock `source-refresh:<source-id>` independently. A concurrent skip leaves
the active job's outcome untouched. Only transient fetch failures are retried,
up to the registered three-attempt ceiling; preview/persistence/validation
failures are not network retries. Failure preserves the last success timestamp.
Out-of-order heartbeat writes cannot replace newer status. Disabled and preview
runs deliberately do not renew freshness, so a sustained pause remains visible
through existing staleness monitoring. Locks are released on failure, and an
unlock failure destroys the connection rather than returning a held session
lock to the pool.

The shared runner does not supply pagination or geography validation for a new
publisher: those remain adapter contracts. CPL continues to enforce its full
feed, baseline identifier retention, schema, geography and exact-byte bounds.
Storage limits and the non-JSON/large-publisher manifest evolution remain
separate work in issues #27 and #28. No new source schedule is activated by this
change.
