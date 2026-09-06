# Patchwork public hostname promotion — 2026-09-06

User explicitly requested deployment to https://patchwork.subcult.tv after reviewing
the protected testing result and open capacity gate. Application source is
8a4a38a699332811f7ab132295c2968d19fd6d16. The API, indexer and moderation images are
identical to the tested candidate; the frontend was rebuilt from that source for the
public API origin. All four image revisions match and are pinned by digest.

The existing public stack was upgraded in place. Its database, uploads, accounts,
session keys, OAuth identity and edge routing were preserved. No candidate database
or test account state was substituted. The protected candidate remains separate.

The deployment uses the existing Compose project `patchwork`, base file
`/srv/repos/subcult/patchwork-release-e36691f12c8f/docker-compose.staging.yml`, recovery
override `/etc/patchwork/docker-compose.nuc-recovery.yml`, and image override
`/srv/patchwork-public/release-8a4a38a.json`. `/etc/patchwork/staging.env` also pins the
new image digests so subsequent normal Compose invocations retain the release.
The historical staging container names serve the public hostname.

A private checksum-verified predeployment backup of PostgreSQL, objects, environment,
Compose files and prior container definitions is retained at
`/srv/patchwork-public/backups/20260906-before-8a4a38a` on NUC. The image-only rollback
override `/srv/patchwork-public/rollback-before-8a4a38a.json` retains previous image IDs.
For an application rollback, append that override last and recreate only the four
application services; restore the backed-up image settings for persistence. Do not
restore the database over new writes without a separate recovery decision. This is
rollback preparation, not a completed version rollback drill.

Migrations: API applied 0027 (26 skipped), indexer applied 0009/0010 (eight skipped),
moderation applied none (five skipped). Existing v2 checkpoint resumed successfully.
All four application services became healthy, with zero restarts. API readiness is ok.
OAuth metadata retains public-hostname client and callback URLs.

Public HTML referenced index-C0lHp0q-.js and index-ZgdPMEm4.css. Their downloaded bytes
match the running container: JS SHA256
02fe1a00463e70e69720c40ec9df13db0aeccb6084afdfe77a1f665293fc96a2,
CSS SHA256 8573b5661d796b422d41768ba949202e7e81f9aed938e5986dfc0981662059a5.

The prior capacity failure, actual notification receipt, physical-phone acceptance,
independent recovery and operational review gates remain open. Deployment to this
hostname does not change the qualification results in the protected testing report.

Public mobile Chromium and WebKit both passed HTTP 200, loaded map tiles, showed
13 example requests and nine places, and passed detail opening, reload restoration
and close/URL clearing. No JavaScript errors or horizontal overflow were observed.
The WebKit detail screenshot was visually inspected. This is deployment smoke
coverage; the two-account handoff evidence remains from the protected candidate.
