# Patchwork map experience deployment — 2026-09-06

User authorized public deployment of the reviewed map changes. Application release
`7b605ca61587710144876505b5b79871f8704b95` is running at https://patchwork.subcult.tv.
The source commit is on Gitea branch `codex/mobile-handoff`.

## Changes

Thin metre-based coverage circles, compact count badges, earlier cluster splitting,
useful expansion zoom, shared-area request chooser, smaller selectable resource
points and passive coverage. Nearby resource links activate a 20 km area search;
PostgreSQL sorts by distance before pagination and the UI displays approximate distances.

## Release and rollback

All four application images were built on NUC from a clean Git archive, labeled with
the source revision, pushed to its local registry, and pinned by digest.
Manifest: `/srv/patchwork-public/artifact-manifest.json`.
Compose image override: `/srv/patchwork-public/release-7b605ca.json`.
Persistent pins: `/etc/patchwork/staging.env`.
No database migrations or data changes were performed.

Predeployment backup: `/srv/patchwork-public/backups/20260906-before-map-experience-7b605ca`.
All seven checksums passed; the custom PostgreSQL dump catalog was validated.
The backup includes the preceding release override and environment, objects and container
metadata. Previous application revision is `a24f1a3`. Restore the previous image pins
and use the backup `release.json` as the final Compose override for an application
rollback; do not restore the database over later writes as part of an image rollback.
The protected candidate was not changed.

## Verification

- Four public application containers report revision 7b605ca, healthy, zero restarts.
- API readiness reports database, projections and chat ok.
- Public JS `index-UiF4S0Nz.js` SHA256 `a0b3ef04d4c88ddb596aeeaf26458ac94ef8d5aa6b24937293d992d8d1eaa8f9`.
- Public CSS `index-BsiRr4On.css` SHA256 `08bcac6b3b48f5a9a3942ae99a1c21bc9f264ebec569cb3464f7639b8f8662bd`.
- Both public asset hashes match the running web container.
- Public API: 40 resource records across two pages are monotonically ordered by
  calculated distance from Chicago (4.159–13.292 km).
- Live Chromium at 390 x 844: one-pixel cluster stroke; area selection loads eight
  New Lenox requests; the shared marker opens a chooser with all eight titles;
  choosing a request opens its detail page. Find nearby resources navigates to
  `/resources?tab=nearby&r=20000&lat=41.51&lng=-87.97`, displaying distances
  0, 9.4, 16.7 and 18.5 km in ascending order. No horizontal overflow (390/390).
- Browser saw a transient 502 while application containers were being replaced;
  reload after startup passed. The signed-out session endpoint returns expected 401.

Predeployment: 29 focused frontend tests, 13 isolated PostgreSQL tests, 10 Chromium
production-build tests, web/API typechecks and diff checks passed. These are scoped
checks, not a full-suite or physical-phone qualification. Existing operational gates
remain open.
