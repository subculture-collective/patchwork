# Integrated fictional Chicagoland seed — 2026-09-06

The user requested removing the examples option and integrating an expanded seed with
obviously fictional names. This supersedes the earlier requirement for separate
community/demo UI modes. Source: `22662707af8df2a5ff7bc2c3841c084093928f1b`.

## Behavior

Nearby, Map and Resources now request the combined dataset. The examples/community
switch is removed, including its explanatory panel. Legacy browser dataset parameters
normalize away while preserving other filters and selected records. Default public API
queries and direct detail lookups include all origins. Explicit API-only community/demo
filters remain compatible for integrations and diagnostics.

Fictional provenance remains attached to every seeded record. Cards use a plain
“Fictional listing” label, and request names include Milo Makebelieve, Tilly Talltale,
Nora Notreal, Felix Fiction, Poppy Pretend, Drew Daydream, Winnie Whatif and Remy Rainbow.
Organization names include Imaginary Acorn Pantry, Makebelieve Moonbeam Welcome Center,
Pretend Purple Platypus Care Circle and Fictional Flying Teapot Tenant Desk, each with
its locality. Existing demo requests gain a Makebelieve name too.

The new regional seed adds 512 requests, 256 organizations and 256 corresponding public
directory listings at 64 approximate locality centers. Together with the earlier small
seed, that yields 525 fictional requests, 265 fictional directory listings and 257
fictional organizations, plus the existing separately attributed public organization
reference. Existing visitor-created records are additional to those totals.

Coverage includes Cook, DuPage, Kane, Kendall, Lake, McHenry, Will, DeKalb and Grundy
counties in Illinois; Lake, Porter, Jasper and Newton in Indiana; and Kenosha in Wisconsin.
The 64 points represent approximate localities, not actual service addresses or exhaustive
neighborhood coverage. Each regional record has 5 km location precision. Regional scope
was informed by [CMAP's seven-county region](https://cmap.illinois.gov/focus-areas/regional-economy/economic-development/)
and its [wider metropolitan-area description](https://cmap.illinois.gov/news-updates/cmap-and-partners-move-forward-on-climate-action-planning-in-northeastern-illinois/).

All new organizations and their contacts are invented. Contacts use `showcase.invalid`;
there are no operational addresses, phone numbers, accounts or outgoing notifications.
The seed writes local projections, not AT provider records. Existing guards continue to
reject real offers on fictional requests and disable fictional resource contact actions.

## Data ownership and repeatability

The regional seed has its own version, `chicagoland-fictional-2026-09-06-v1`, stable keys,
deterministic names/content/age variation, provenance metadata and content manifest.
It runs inside the existing seed transaction and advisory lock. It rejects collisions
with visitor records or another seed's metadata, and only upserts its own tagged keys.
A rerun does not duplicate organizations or requests. The earlier small seed retains
its existing version and ownership checks.

## Verification

- Repository checks passed: 1,069 tests, 142 infrastructure-dependent skips, plus map,
  exact-location absence, localization and operational checks.
- PostgreSQL seed/discovery/coordination regressions: 21 passed. Coverage includes
  replay/idempotency, visitor preservation, 512/256/256 counts, all 64 localities,
  all 14 county/state pairs, fictional naming, non-routable contacts, mixed discovery,
  paging, direct lookup, legacy API filters and synthetic coordination rejection.
- Focused Chromium navigation/selection checks: 15 passed, including legacy dataset
  removal and URL selection restoration.

The previously failed 40 RPS capacity gate and human phone/notification/recovery gates
remain open. This change does not claim to close those unrelated qualification items.

## Public deployment and final checks

Deployed to https://patchwork.subcult.tv, preserving the public environment and data.
Four application images have revision `22662707af8df2a5ff7bc2c3841c084093928f1b`,
are digest-pinned, healthy, and have zero restarts. Pins are persisted in
`/etc/patchwork/staging.env`. Compose image override:
`/srv/patchwork-public/release-2266270.json`; manifest:
`/srv/patchwork-public/artifact-manifest.json`.

The predeployment backup at `/srv/patchwork-public/backups/20260906-before-fd26c2b`
contains checksum-verified database, objects, environment and container definitions.
`rollback-before-regional.json` retains the prior images. No new schema migration was
needed. Visitor request/resource/organization counts were compared before and after
seeding and were unchanged. A prior-code rollback alone does not remove the expanded
fictional rows; any seed cleanup must be scoped by its version and synthetic provenance.

Live default API totals: 526 requests (525 fictional plus one visitor), 265 directory
resources, 259 organizations (257 fictional, one public-source reference, one visitor).
Default search returns 16 requests for Kenosha, eight for Rensselaer and eight for DeKalb.
The selected 50 km Chicago map area contains 326 requests and 165 places with bounded
20-record pages. Downloaded public JS/CSS SHA256 values match the running container.

Mobile Chromium and WebKit both passed live map/tile rendering, absence of the examples
switch, obvious fictional names, detail opening, selection restoration on reload and
close/URL clearing, with no JavaScript errors or horizontal overflow.

The broad Chromium run passed 173 tests with two existing credential-dependent skips;
one test still expected the replaced “Synthetic showcase” label. After updating that
expectation to “Fictional listing,” all 25 production-mode, map-selection and navigation
checks passed with no retries. The final wording-only change was covered by that run
and the deployed browser checks; this is not a second full-suite run.

Additional live iPhone WebKit checks passed on Organizations and Resources: invented
organization names are visible, with no JavaScript errors or horizontal overflow.
The organization screenshot was visually inspected.
