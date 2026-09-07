# ZIP request locations and claimable public resources

Implemented on `codex/mobile-handoff`, 2026-09-06. Deployment evidence is recorded separately; this document describes the implementation, not a release certification.

## Public location model

New requests require a supported five-digit US ZIP, preserved as text including leading zeros. Version 2 AT records publish only `countryCode` and `postalCode` in the location object. Server validation canonicalizes any internal coordinates to the ZIP representative point; ingestion retains the ZIP. Legacy version 1 records remain readable, but records without a confirmed ZIP have no public discovery coordinates and do not appear in nearby map queries. Existing federated copies are not erased.

The posting form does not ask for GPS or a street address. Exact request addresses remain part of the existing private exchange. ZIP areas are not an anonymity guarantee: some ZIPs cover small areas.

The map shows states below zoom 7, counties at zoom 7–9, and ZIP areas at zoom 10 and above. Clicking a larger boundary advances to the next level. Requests in the same ZIP remain together at street zoom; selecting a ZIP filters the request list. No request offsets or fuzzy circles are used. URLs preserve ZIP identity without per-request coordinates.

Resources are separate, uncounted pins at eligible public street addresses. Visible pins scale from 5 to 18 pixels with zoom inside an interactive target that also scales with zoom (16–26 pixels). Resources sharing an exact address open a resource list at that location. The map loads every page of the resource result set. Directory distance filtering and sorting use eligible exact addresses before pagination. Nearby resource links automatically search from the request ZIP representative point; those distances are from the ZIP area.

## Geography provenance and reproduction

The supported catalog contains 33,791 Census 2020 ZCTAs. It is not a complete USPS ZIP validation service. Unsupported ZIPs receive an explicit validation error. ZCTAs approximate ZIP delivery areas; they are not political jurisdictions. State and county borders are Census boundaries.

Source archives:

- https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip
- https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_county_500k.zip
- https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_state_500k.zip

Documentation: https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html and https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html.

`scripts/build-postal-geography.py` builds the lookup and geometry bundles using the pinned dependencies in `scripts/postal-geography-requirements.txt`. Run `python scripts/build-postal-geography.py /path/to/extracted-inputs`, with shapefiles in `zcta/`, `county/`, and `state/` subdirectories and source archives beside them; outputs are written into this checkout. Each ZIP receives one parent county from its public representative point (nearest county for coastal gaps), and that county supplies its state. Cross-boundary ZIPs are counted once and retain their full ZIP shape. No requester position influences parent assignment.

Artifacts live under `apps/web/public/geography/census2020`: one state file and 56 county plus 56 ZIP bundles, loaded by state as needed. The manifest records archive, artifact and lookup checksums. This is versioned JSON, not vector tiles. All 113 artifacts and the 33,791 ZIP lookup/parent assignments were checked for parity. Total geometry is about 71 MB; detailed nationwide polygons are never fetched as one response. The ZIP lookup currently contributes to the main JavaScript bundle (about 596 KB gzip total); further code splitting remains a performance opportunity.

## Public resource seed

The first catalog is 81 Chicago Public Library locations, imported from the City of Chicago dataset https://data.cityofchicago.org/d/x8fc-8rcq on 2026-09-06. The source contained 82 rows; Galewood-Mont Clare was excluded because its schedule says closed until further notice. The checked-in source includes branch IDs, real street addresses, ZIPs, coordinates, official branch websites, public phone numbers, usual hours and source provenance. Hours are not a live open-now signal.

Imported places begin unclaimed and unverified as organizations. Inclusion does not imply partnership or endorsement. Public source evidence supplies address eligibility without fabricating organization memberships or steward approval. Source eligibility expires 90 days after retrieval; operators must review and refresh the catalog before expiry. The initial seed command deliberately does not overwrite later claimed edits or refresh evidence without a new source review.

The seed also creates 512 explicitly fictional requests across 64 ZIP selections. The command `npx tsx services/api/src/db/postal-discovery-seed.ts` previews counts using `API_DATABASE_URL`; `--apply` performs the transaction. It replaces only known synthetic discovery projections whose origin and seed version match their metadata. It fails on ownership mismatches or collisions, preserves visitor records, and is idempotent. Existing seed organizations/workflow examples are not impersonated as real library operators or deleted by this discovery reset.

Live inventory found one visitor-created request alongside 525 synthetic requests and 265 synthetic resources. That visitor record must survive the release unchanged; without a ZIP it remains readable but is omitted from the new ZIP map. Back up the database before applying migrations or seed replacement.

## Reviewed claims

A signed-in organization owner or admin submits a claim with evidence of authorization. Evidence is visible to its applicant and platform reviewers. Pending claims grant no editing access. An independent platform reviewer must verify the organization's current verification and relationship to the place before approval; members of the claiming organization cannot approve it. Listing locks serialize competing claims. Review reasons and changes are audited.

An approved, currently verified organization can edit name, usual hours, access requirements, website and phone through Organizations → Resource claims. Street addresses remain subject to the existing location review process. Imported source snapshots remain intact through edits. Reviewers can deny pending claims and revoke approved claims. Account export includes the person's claims; deactivation removes private claim evidence and redacts their audit actor. Deleting an owning organization unclaims the public listing instead of deleting the public place.

## Verification and release limits

- Six affected workspace typechecks passed; final API/web/indexer typechecks passed after integration.
- AT lexicon/encoding, API client, posting, ingestion and command tests cover ZIP-only publication and leading zeros.
- PostgreSQL discovery tests cover count conservation, exact-coordinate ordering, idempotent seed replacement and visitor preservation. Claim tests cover independent review, pending permissions, verification, edits, revocation, source retention and account privacy.
- Targeted browser regression: 10 unified discovery checks and 2 ZIP posting checks passed, including granted and denied geolocation.
- Hands-on production-build mobile browser: ZIP 60625 reload, one polygon for eight requests, exact library pins, real address/source links, anonymous claim guidance, and no horizontal overflow at 390 pixels.

Local browser discovery used an isolated PostgreSQL API with transport routing and the public basemap. Its missing OAuth/status dependencies are not proof of production authenticated readiness. Claim authorization was exercised against PostgreSQL; a real representative has not claimed a live listing. This release is not a claim that every broader project readiness, capacity or human acceptance gate has passed.
