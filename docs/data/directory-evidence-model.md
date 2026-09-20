# Directory identities and field evidence

Issue #24 introduces a shared contract in
`packages/shared/src/resource-directory.ts`. This first slice is a validated
in-memory/exchange model and a legacy-profile compatibility view. It does not
replace database storage, discovery reads, public AT records, or the reviewer UI.
Database persistence/backfill and its PostgreSQL compatibility tests remain part
of #24; do not mark that issue complete from the contract alone.

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

Verification includes many-to-many relationships, absent service hours at an open
building, competing sources, expiry after unchanged observation, confidential
location rejection, remote services, and legacy preservation/replay. Rollback of
this slice is code-only because no stored data or routes change.
