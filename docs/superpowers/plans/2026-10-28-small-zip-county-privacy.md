# Small-ZIP county publication — issue #133

Scope: an opt-in county location for aid requests. No population source,
hexagonal grid, retrospective record rewrite, or volunteer-area change.

## Implementation sequence and acceptance

1. Rebuild the existing Census 2020 ZIP lookup with `ALAND20` for all 33,791
   entries; add county representative points and land areas. Preserve boundary
   geometry and verify archives against the existing manifest hashes. Check all
   113 boundary artifacts and parent assignments in `test:maps`.
2. Define the shared land-area threshold as below 1 km². Keep ZIP as the
   default, warn in English/Spanish, and offer county publication explicitly.
   Reset the selection when the ZIP changes. The private expiring text draft
   may retain the entered ZIP; public encoding uses only the chosen county.
3. Add aid-post version 3.0.0 and its fixture. Validate supported county IDs,
   derive their representative point internally, and reject finer fields in
   public commands. Keep v1/v2 decoding, CID operations and safety review.
4. Preserve county identity across ingestion and live/shadow projections.
   Include county requests in nearby queries and county/state map counts;
   exclude them from ZIP buckets/filters. Feed/map/detail labels show county
   names; nearby resources and advisory matching use and label the county point.
5. Verify schema/wire privacy, legacy compatibility, map counts, PostgreSQL
   ingestion/discovery/filtering/matching and the bilingual posting/detail/feed
   journey. Run the full type/unit/database/browser and operational/privacy
   gates. Publish a PR closing #133 on merge, with hosted CI reported separately.

## Verification

- `npm run typecheck`
- `npm run test:coverage`
- `npm run test:integration`
- `npm run test:integration -- services/api/src/county-discovery.postgres.test.ts services/api/src/coordination-service.postgres.test.ts services/indexer/src/db/projection-store.postgres.test.ts`
- `npm run test:e2e -w @patchwork/web`
- `npm run test:operations`
- `npm run test:maps`
- `npm run test:exact-location-absence`
- `npm run test:e2e:redact`

The browser journey mocks HTTP responses; PostgreSQL tests use real disposable
storage. No deployment or credentialed PDS journey is implied. Migration and
rollback order are documented in the postal-geography and lexicon guides.
