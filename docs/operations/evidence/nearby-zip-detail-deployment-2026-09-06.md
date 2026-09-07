# Nearby ZIP detail deployment — 2026-09-06

Application `409faf9d12494a1b3813832147dfe6cec936540c` is deployed at https://patchwork.subcult.tv and pushed to Gitea `codex/mobile-handoff` under the user's explicit deploy instruction.

## Release

Small permanent ZIP count badges, selectable/highlighted counties including empty counties, four map detail levels, and a focused ZIP request panel with return navigation. Mobile ZIP selection brings the map into view above the bottom panel.

All four public application containers (web, API, spool, thimble) are healthy at the matching revision with zero restarts. Images were built from a clean committed archive on NUC, pushed to its local registry, and pinned by digest in `/etc/patchwork/staging.env`. Current override: `/srv/patchwork-public/release-409faf9.json`; manifest: `/srv/patchwork-public/artifact-manifest.json`.

Image/config rollback backup: `/srv/patchwork-public/backups/20260906-before-zip-detail-409faf9`. All three checksums passed. The backup preserves the prior 575c43a environment, image override and manifest. Restore those pins and use the backup release.json as the final Compose override for an application rollback; no database restore is needed. No migrations, seed replacement, claims or outgoing messages were performed. Protected candidate unchanged.

## Verification

Predeployment: web typecheck, production build, diff check, ten unified-discovery regressions and one additional previous-area restoration browser regression passed (11 total).

Live Chromium, without local API routing:

- Cook County keyboard selection shows aria-pressed=true and advances to ZIP areas; 48 compact ZIP count labels in the selected 65 km search. Empty county boundaries remain selectable.
- ZIP 60625 selection opens all eight request rows at `/nearby?zip=60625&area=ZIP+60625`.
- Opening and closing an individual request returns to the ZIP list. Back to ZIP areas restores `/nearby?r=65000&lat=41.88&lng=-87.63`.
- Direct ZIP navigation at 390×844 shows the map above the panel, map top approximately zero, and no horizontal overflow. Screenshot: `output/playwright/deployed-zip-detail-409faf9-mobile.png`.
- Maintenance false; 512 synthetic requests, one visitor-created request and 81 listed public resources remain.
- Signed-out session endpoint returns expected 401; this is not an authenticated posting acceptance run.

Public asset hashes match the running web image:

| Asset | SHA256 |
|---|---|
| index-mek6qQ82.js | e892fc778f1f337475a1a93c15034c097d3c14816b6bbed9b4d899e6b4e57099 |
| index-B6P8ZCgX.css | b41bb7799e0d29de3a3ee12263f914fa721f183344afbbfe4f1254e29647867e |
| PostalMap-CIGW-MKW.css | fcd9fbeec3e87013f776847f0e76395d4d7eba07d982964933a41bd07503e6fe |
| PostalMap-BxHv70ox.js | a3450ed7af0ce52dffbd6e1b0b5eab0f9d6f206eae8103e8877c40522cdcc758 |

These are targeted release checks. Broader capacity and human acceptance gates remain separate.
