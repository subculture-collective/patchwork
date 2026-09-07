# ZIP map and public resource deployment — 2026-09-06

Application `a799daf5db41077319ec13b8aa3868dabfbb8084` is deployed at https://patchwork.subcult.tv and confirmed on Gitea `codex/mobile-handoff`. This replaces the previously deployed circle map. User authorization covers the map redesign, rebuilding the seed, real publicly accessible resources, claiming, and deployment.

## Delivered behavior

Requests publish supported five-digit ZIP locations in version 2 AT records. The map progresses through state, county and ZIP boundaries; further zoom never divides a ZIP into individual request positions. Resources render as separate exact-address pins, excluded from request counts, with size changing by zoom. Nearby resource searches activate automatically and sort on exact resource distance before pagination.

The discovery seed now contains 512 clearly labeled fictional ZIP requests and 81 real public Chicago library locations. The source branch marked closed was excluded. Source listings begin unclaimed and preserve provenance; independent reviewed claims enable verified organizations to edit listing details. Pending claims grant no edit access. No real organization claim or outgoing message was created during testing.

## Cutover and preservation

NUC built all four images from the committed Git archive and pushed them to its local registry. The persistent digest pins are in `/etc/patchwork/staging.env`; image override `/srv/patchwork-public/release-a799daf.json`; manifest `/srv/patchwork-public/artifact-manifest.json`. All four web/API/spool/thimble containers report the full application revision, healthy, zero restarts after cutover. The protected candidate was not changed.

Backup: `/srv/patchwork-public/backups/20260906-before-postal-a799daf`. Eight checksums passed, including the database dump, objects, image/environment records, and visitor fingerprint. PostgreSQL custom dump catalog validation passed. Application writers were stopped for the backup and migrations. The persistent maintenance state and audited declaration kept submissions paused through read-only public verification; the state was resumed and API recreated to reload it. Public browser reload confirms the maintenance banner is gone.

Applied indexer migrations 0011–0012 and API migrations 0028–0030. Moderation migrations were already current. Seed preview confirmed 525 synthetic requests, 265 synthetic resources and one visitor request. The transactional replacement removed only known seed-owned discovery projections. The visitor record count and canonical content fingerprint match before/after; one visitor request remains. Legacy records without ZIP remain readable but absent from the new ZIP map. Existing synthetic organization/workflow examples were not converted into real library representatives.

Scripts retained on NUC: `/tmp/patchwork-postal-build.sh`, `/tmp/patchwork-postal-rollout.py`, `/tmp/patchwork-postal-resume.py`. These are single-use release scripts, not idempotent recovery tools. The source archive and release directory are under `/srv/patchwork-public/releases/a799daf5db41077319ec13b8aa3868dabfbb8084`.

Rollback: retain the database and objects backup plus previous `7b605ca` image override. Since this release changes discovery data, an application-only rollback does not restore the old seed. Now that submissions have resumed, do not restore the pre-cutover database over later writes. Enter maintenance, take a new backup, inventory changes since cutover, and reconcile them before any data restore. Additive schemas can remain for an image-only emergency rollback, but old map behavior and ZIP-only records need explicit assessment. No rollback was needed.

## Verification

- Local: six affected workspace typechecks; focused encoding, normalization, API, posting and geography tests; 13 PostgreSQL query tests, 13 indexer projection tests, 5 postal/claim tests, and 3 account privacy HTTP PostgreSQL tests passed. Final web production build and diff check passed.
- Targeted production-build browser regression: 10 unified discovery and 2 ZIP posting tests passed. These are scoped checks, not a full application suite or physical-phone acceptance.
- Live Chromium at 390×844 with all test transport routing removed: ZIP 60625 reload renders one request polygon and eight requests; 51 eligible nearby resource markers exist; no horizontal overflow. Resource detail displays Albany Park library, 3401 W. Foster Ave., Chicago IL 60625, official branch link, phone, directions, public source and unclaimed status. Anonymous claim action presents sign-in/organization guidance and creates no claim.
- Live API through the browser: ZIP 60625 query returns HTTP 200, total 8, all eight postal codes 60625. Directory query returns HTTP 200 and all 81 records. Claims count remains zero; maintenance is false.
- Live desktop: keyboard activation of Cook County advances to ZIP boundaries (48 rendered ZIP polygons in the selected 65 km search), all 81 resource pins remain separate, and the visible pin width increases from about 9.4 to 10.5 pixels at the next zoom.
- Expected signed-out `/auth/session` and `/organizations/mine` responses are 401. Earlier direct Python HTTP probes were rejected by the public gateway; browser reads and container readiness were used as evidence. No claim of a fully authenticated live representative workflow is made.

Public asset hashes match the running web image:

| Asset | SHA256 |
|---|---|
| `index-Utn1sJad.js` | `c4171023a6aac5d46a668c87943914483bac427ca01fed15427b031cb13f4708` |
| `index-DpyUTuDa.css` | `35d6d87c816d2846bfc22911a1d891463a4e172f38c4195e42cc53861a5d5791` |
| `PostalMap-CIGW-MKW.css` | `fcd9fbeec3e87013f776847f0e76395d4d7eba07d982964933a41bd07503e6fe` |
| geography manifest | `67322e836af8f570a154435b363a8e637c739fcb9f95ed166c0c0d8e93a54d55` |
| Illinois ZIP boundaries | `8c461f384853e0925eff704e6d91a64d5680d5651164a956ab1c707374ab96b0` |

The first Gitea pushes timed out through the public gateway (HTTP 524). The same authenticated push succeeded through an SSH tunnel to the verified existing Gitea proxy, and the public remote branch was read back at a799daf. No proxy, repository authentication or fleet configuration was changed.

## Operational limits

Census 2020 ZCTAs provide a supported geographic ZIP subset, not every USPS ZIP. Imported library hours are usual schedules, not live opening status. Public source eligibility expires after 90 days and needs an operator-reviewed refresh; rerunning the seed alone does not refresh evidence or overwrite claimed edits. Main JavaScript is about 596 KB gzip; geographic detail is lazy-loaded in state bundles. Capacity, full-suite and human acceptance gates from the broader project remain separate.
