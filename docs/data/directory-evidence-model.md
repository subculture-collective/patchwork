# Directory identities and field evidence

Issue #24 introduces a shared contract in
`packages/shared/src/resource-directory.ts`. Additive migration 0038 and
`resource-directory-store.ts` retain its entities, relationships and assertions.
Existing discovery reads, public AT records, and the reviewer UI still use the
existing profile path. Switching those consumers to this model requires separate
review and qualification; storing evidence alone does not publish it.

An organization is a publisher-described entity, not a verified ownership claim.
A place describes a site. A service describes an offering independently of the
building. Service-location relationships allow several offerings at one site and
one offering at several sites. Organization membership is explicit; matching
names never establishes shared ownership. The graph is bounded per import batch,
not intended to hold the entire national catalog in one document.

Each assertion names its exact subject, field, source, observation time, original
confirmation and expiry, review state, conflict state, and raw-byte hash when one
exists. `directoryAssertionsFor` only returns current assertions for that exact
subject. Building hours are not service hours, and service hours do not silently
inherit into a site-specific delivery. Multiple matching assertions are returned
as alternatives; a caller must resolve conflicts through review, not select the
newest source. An explicitly open conflict is never qualifying evidence.

Observed time records seeing the source. It does not renew confirmation or expiry.
Pending, rejected, expired, future-confirmed, and openly conflicting assertions
cannot qualify filters. Existing eligibility evaluation continues to enforce the
per-rule evidence inside an eligibility assertion as well; the new graph is not
an eligibility engine or an HSDS conformance claim.

Remote-only services need no site and cannot have a physical service-location
relationship. Confidential places have no public listing reference. This contract
contains no address or coordinate fields; existing public-address approval remains
the authority for coordinates. It contains no personal travel origin or private
coordination data, and it adds no public AT record family.

`directoryFromLegacyProfile` is a deterministic, non-mutating compatibility view.
The caller supplies the original observation time and explicit source identities
for every evidence URL. It preserves the original evidence dates and conflicts,
leaves unavailable raw hashes null, and keeps similarly named organizations and
services scoped to their original resource until a separate reviewed identity
decision links them. Resource-level display hours are never parsed into service
schedules. No database backfill runs merely by importing this helper.

The store writes one graph transaction at a time and checks canonical hashes on
replay/readback. Existing identities are immutable through this intake API:
changed content fails instead of overwriting evidence or extending its dates.
New evidence needs a new assertion identity. Changing entity identity metadata or
making a review decision needs an explicit future reviewed transition; this store
does not implement conflict resolution or identity merges. Typed foreign keys
bind assertions to exactly one organization, place, service or service-location.

## Bounded legacy backfill

Apply the normal API migrations, then preview one page:

```sh
npm run resources:directory:backfill -w @patchwork/api -- --mode=preview --limit=25
```

Use `--mode=persist` to retain that page and `--after-uri=<nextAfterUri>` to advance.
The maximum page is 100 profiles. Each profile is atomic; if a later profile fails,
earlier profiles remain committed. Replaying the same page is safe and reports
zero new rows for identical data. A changed profile at an existing identity fails
closed for review. There is no automatic loop, schedule, or production backfill.

Only existing structured profiles are converted. A plain location listing does
not acquire service assertions from its display hours or category. Source IDs
prefixed `legacy-url:` identify the exact previously recorded evidence URL; they
do not authorize publisher fetching or claim runtime-adapter qualification. The
profile's stored update time becomes the legacy observation time, not a new
publisher fetch or confirmation. Original confirmation and expiry stay intact;
missing raw-byte hashes remain null. Equal organization names across resources
remain separate until reviewed matching establishes identity.

## Compatibility and rollback

Migration 0038 creates five independent directory tables and indexes, with no
changes to existing tables, public-address views, ownership claims, or AT schemas.
The legacy profiles, their history and initial publisher snapshots remain the
current application read path. The backfill reads them without mutation. Older
application code can run with the additive tables left in place; rollback the
application and stop the backfill, retaining the new evidence for investigation.
Do not delete the tables or edit the migration ledger as an ordinary rollback.
Any eventual physical removal requires a verified evidence backup and removal
of all consumers first. Ordinary database backups include these tables; an
independent production restore remains the separate #17/#27 qualification gate.

Verification includes many-to-many relationships, absent service hours at an open
building, competing sources, expiry after unchanged observation, confidential
location rejection, remote services, transactional rollback, hash corruption,
typed foreign keys, bounded preview/paging and legacy preservation/replay.
