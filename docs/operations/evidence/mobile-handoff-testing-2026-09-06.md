# Protected mobile handoff testing — 2026-09-06

The candidate is available at https://patchwork-test.subcult.tv behind an access gate.
Application source: `8a4a38a699332811f7ab132295c2968d19fd6d16`, branch `codex/mobile-handoff`.
This is testing availability, not public launch approval or completion of the human milestone.

## Access and testing

The operator handoff is `/home/onnwee/.local/share/patchwork-testing/access.txt`.
It contains the access gate credentials and a seven-day signup invitation. Do not copy
credentials, invitation tokens, account passwords or browser storage into the repository.
Open the candidate, enter the gate credentials, then use the invitation to create a test
account. Helpers must save a volunteer profile at `/volunteer` before offering assistance. Examples are
separate from community requests and cannot accept real offers.

Use two accounts to post a clearly identified test request with an approximate area,
open its shared detail, offer assistance, accept, exchange a message, agree on a time,
and complete the handoff. Repeat with roles reversed on iPhone Safari and Android Chrome.
Record confusion, failed steps and perceived delays without coaching. Remove disposable
public source records afterwards. Browser emulation does not replace these human exercises.

## Verified application behavior

- The real-service automated two-account journey passed through the public HTTPS edge:
  source publication, projection, offer, acceptance, chat receiving, scheduling acceptance,
  completion and notification endpoint access. Projection took 5,584 ms; foreground chat
  took 3,786 ms. The source request and helper profile were deleted successfully (204).
  The harness uses authenticated HTTP mutations plus real browser detail/chat observation;
  it is not an uncoached, all-buttons UI journey.
- Full final API integration: 434 passed, no skips, using PostgreSQL and actual MinIO/ClamAV.
  Indexer: 65 passed with PostgreSQL. Moderation: 71 passed with PostgreSQL.
- Final repository checks: 1,069 tests passed, 141 infrastructure-dependent skips; localization,
  map artifacts, exact-location absence and operations checks passed. Infrastructure runs
  above cover their applicable services separately.
- Broad Chromium suite: 174 passed, two existing credential-dependent skips. After final map
  copy changes, 57 targeted localization/map/history/production-mode cases passed. Later
  fixes were backend-only. This is not a new full browser run after every backend fix.
- Initial deployed JavaScript measured 190,868 gzip bytes, below the 200,000-byte budget.
- Production dependency audit: zero high/critical and four moderate transitive findings.
  MinIO uses query-string stringify, not the vulnerable parse path; its stream-json path is
  the notification poller, unused by the application's object-store adapter. These findings
  remain open; no unverified major SDK upgrade was forced.

## Defects found during real deployment

Candidate boot exposed incompatible notification-channel validation, a map tile URL
configuration error and incorrect session-key encoding. These candidate settings/schema
were corrected. Discovery SQL now pages bounded results, calculates shared aggregates,
and avoids numeric-conversion overhead. A fresh live indexer bootstraps only relevant
Patchwork history and reports actual event freshness instead of refreshing a stale cursor's
heartbeat. HTTP retry metadata no longer corrupts strict modern domain command bodies.
The successful live handoff was performed after these corrections.

## Deployment and recovery boundary

NUC hosts seven separate candidate services at `/srv/patchwork-candidate/compose.yml`:
web on LAN 3051, API on LAN 3052, spool, thimble, PostgreSQL, MinIO and ClamAV.
Docker networks are 10.252.20.0/24 and 10.252.21.0/24. Candidate database, object data,
application/session/signing secrets and containers are separate from the existing public
site. Managed AT PDS and Jetstream remain shared external providers. Tiles are shared
read-only and pinned to SHA256 `9a7697125792ba1aa267fca4fa8751172ddd9347e00e9462beb727edf9bbde82`.

Almaz Caddy imports `/opt/server/management/config/caddy/sites/patchwork-test.Caddyfile`.
The candidate is gated and marked noindex; OAuth client metadata alone is publicly readable.
The original public site's containers and routes were preserved.

The four images are pinned by digest in `/etc/patchwork-candidate/images.env` with a coherent
source manifest at `/srv/patchwork-candidate/artifact-manifest.json`. Runtime secrets live in
`/etc/patchwork-candidate/candidate.env` (private). Local registry tags use the full source SHA.

A checksummed database/object/config backup was restored into separate disposable containers.
The restored database had 10,000 synthetic requests, 1,000 synthetic resources and two policy
consents; an S3 object read matched SHA256
`7169ba8299293c0f7e29bef8755047ff960211c9b6f943f083219f8a047958c3`.
Evidence is retained at `/srv/patchwork-candidate/backups/20260906-pretesting`.
Restore containers are stopped. This is a local NUC restore, not independent off-host recovery.
The earlier image set has known defects and is not a qualified rollback target.

## Remaining release gates

Human phone participants and a designated real notification recipient have not been supplied.
Push is configured independently; no real email delivery is claimed. A notification API read
is not proof of operating-system push receipt. Broader route extraction and contextual recovery
when a new helper has not created a volunteer profile remain product polish work.
Independent backup, qualified version rollback/forward, independent reviews, responder and
moderation/support ownership, and stewarded community content remain public release gates.

## Final capacity result and testing dataset

The final five-minute probe against 10,000 requests and 1,000 resources **failed** the
40 aggregate read RPS / 500 ms p95 gate. It completed 11,968 requests, all HTTP 200,
but missed 32 scheduled requests. p95: directory 1,510.77 ms, feed 1,033.27 ms,
map 1,070.80 ms. Maximum observed projection heartbeat lag was 16.994 s.
No application container restarted. This probe ran from Almaz to the candidate API,
with 100 forwarded test client identities; it excludes Cloudflare and browser rendering.
No image builds ran during the final probe. NUC hosts other workloads; no causal
attribution to those workloads is established by this measurement.

Earlier failed probes are retained alongside the final result in
`output/live-testing-20260906/`. The final result supersedes earlier throughput claims,
without erasing failures. Capacity remains an open delivery item; do not promote this
candidate as having passed the original performance target. The next capacity task is
to profile SQL execution and queueing under representative varied queries, preserve
privacy/freshness semantics, and rerun the same gate after a measured change.

After the measurement, exactly the 10,000 request and 1,000 resource capacity seed rows
were removed. The versioned Chicagoland showcase seeder installed 41 records
(manifest `7d8acadf648f4c830a589e549be560f2e1ad3c641214c71f8bb7c38cbf9be029`).
Synthetic examples remain separate and cannot accept offers. This does not establish
stewardship or current operating details for real resource organizations.

A fresh checksum-verified backup of the current testing dataset, objects, configuration
and manifest is retained at `/srv/patchwork-candidate/backups/20260906-testing-8a4a38a`.
The restore proof above used the earlier backup; this newer backup was checksummed,
not separately restored. Anonymous candidate access is 401, authenticated access is 200,
public OAuth metadata is 200, and the existing public site remains 200.

## Live mobile rendering

After showcase seeding, mobile Chromium (Pixel 7 emulation) and WebKit (iPhone 13
emulation) both returned HTTP 200, loaded the basemap, and rendered 13 example requests
and nine places within the explicit 50 km area without JavaScript errors or horizontal
overflow. The WebKit full-page screenshot was visually inspected. These are actual
candidate responses and browser engines, not physical-device tests.

Both engines also passed live request-sheet opening, selection restoration after reload,
and Close clearing the selection URL. Screenshots and the sanitized browser report are
retained with the capacity and handoff evidence.
