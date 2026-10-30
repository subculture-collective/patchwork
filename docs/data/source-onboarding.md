# US source onboarding and coverage

[Issue #23](https://git.subcult.tv/subculture-collective/patchwork/issues/23)
tracks this inventory. It describes existing imported evidence, not a new
publisher fetch, a legal clearance or a live database count.

## Reproduce the inventory

```sh
python3 scripts/inventory_public_sources.py > /tmp/patchwork-source-inventory.json
python3 scripts/inventory_public_sources.py --format markdown > docs/data/source-inventory.md
python3 -B -m unittest discover -s scripts -p 'test_inventory_public_sources.py'
```

The read-only command accounts for each of the five catalogs and every source
identity. JSON retains publisher endpoints, dates/hashes, region/category/service
counts and sample resource IDs. It rejects missing source references and duplicate
identities rather than silently double-counting. It does not verify a catalog's
source hash against original bytes. Earlier builders often hash canonical JSON;
the current CPL adapter retains exact response bytes. Do not conflate those bases.

[source-inventory.md](./source-inventory.md) is the generated review view.
[source-policies.json](./source-policies.json) contains family-level format,
identifier, exclusion, reuse/access assessment and follow-up issue. Family
assessments never grant permission to every publisher in that family.

## Practical intake order

1. **HRSA health centers (#33):** the HCSD download page states no usage
   limitations and describes daily updates. Build a complete bounded adapter,
   preserving address suppression and current importer exclusions. The publisher
   statement does not establish rate limits, transformed-data accuracy, hours
   or eligibility. [HRSA download terms](https://data.hrsa.gov/data/download?titleFilter=Health+Center).
2. **Approved food publishers (#34):** verify feed-specific permission or obtain
   an authorized export before scheduling the existing networks. Vivery's Site
   terms restrict automated access/copying; whether an Access Food API/network
   has separate permission remains unresolved. The inventory does not authorize
   recurring collection or alter existing published records. [Vivery terms](https://www.vivery.org/terms-of-use/).
3. **Housing and public offices (#35), benefits (#36):** qualify each endpoint,
   rights/access, stable ID and pagination independently. Office existence does
   not establish available benefits or appointments. VA's imported endpoint
   version needs reconciliation with the [official facility API](https://developer.va.gov/explore/api/va-facilities/docs).
4. **Local practical services (#37/#38):** manually verify the first non-library
   schedules and access assertions while preparing approved municipal feeds.
   Prioritize food, housing, health, legal/access assistance and cooperative
   resources. Keep libraries opt-in.

## Before enabling any new source

- Record the actual publisher and feed contract, allowed reuse/attribution and
  source-specific access limits, with dated evidence. Unknown remains unknown.
- Identify stable organization/place/service IDs and source overlap. The 106
  national food-network identities are not 106 independent transport APIs.
- Keep original response evidence distinct from normalized catalogs, coordinate
  geocodes and service assertions. A geocoder endpoint cannot refresh services.
- Validate complete paging/counts, schema, country/geography and coordinate
  quality; quarantine suspicious shrinkage without deleting public records.
- Preserve importer exclusions until the service/occurrence model supports the
  excluded cases. Never reconstruct suppressed addresses from another dataset.
- Preview changes, retain evidence, resolve duplicates and source/provider
  conflicts, then apply the reviewed publication policy. Last-good data survives
  source failure. Schedules/eligibility/closures are not automatic contact edits.
- Qualify the adapter, bounded run, monitoring and natural scheduled execution
  separately. Existing source-policy classifications are planning metadata,
  not an executable runtime enable switch.

## Coverage limits and metadata findings

State totals show where checked-in records exist. They do not establish complete
state, county, rural, tribal or territory coverage; absent categories or records
mean unknown coverage. Current catalogs do not supply qualified structured hours
and eligibility merely because their display strings mention them. The next
coverage dashboard must measure assertion freshness and sampled usefulness as
well as locations.

The generated findings identify a Wayside Cross source whose `apiUrl` is HRSA,
a Grundy provider whose `apiUrl` is a geocoder, overlapping Chicago/national
HRSA provenance and the VA version question. Retain these imported snapshots
unchanged and resolve the fetch contracts from original evidence before adding
adapters. The registry must not blindly fetch every stored `apiUrl`.
