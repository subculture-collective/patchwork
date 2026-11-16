# Android public discovery and cache

Implements the code portion of #261. The phone Browse surface offers requests,
offers, public resources, volunteers and organizations without requiring an
account. Search, category/status, demo/community filters, next/previous pages,
public details, provenance and unavailable/empty/loading states use native
English/Spanish resources. Member-authored content stays in its source language.

## Public API contract

The client uses only anonymous `GET` requests to `/query/feed`,
`/query/directory`, `/query/volunteers`, `/organizations`,
`/organizations/profile` and `/query/directory-resource`. Its HTTP client has
no cookies, bearer header, redirect following or shared HTTP cache. Organization
profiles can open linked public resources while retaining the selected dataset.
No member commands, chat, applications or private profiles use this cache.

Requests/offers use the existing feed `postType` filter. Category and status
filters follow each route's own vocabulary; volunteer status means availability.
Resource directory defaults, including its exclusion of libraries unless the
library category is selected, follow the current server API. Every list page is
bounded to 20 rows; future/unknown status values have an explicit unavailable
label, without inventing an actionable state. Missing legacy post type defaults
to request, and missing legacy origin to visitor-created.

This slice adds optional bounded server pagination to `GET /organizations`.
Supplying `page`, `pageSize` or `dataset` selects this response:

```json
{
  "organizations": [],
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "hasNextPage": false
}
```

Page numbers are 1–100000, page sizes 1–100 and datasets `all`, `community` or
`demo`. Search text is at most 120 characters. Filtering/counts/pagination stay
in PostgreSQL with stable name/ID ordering. Callers that omit all three new
parameters retain the existing `{ organizations: [...] }` response, including
the web client's search-only requests. Native callers require this server
addition before live qualification; an older unpaged response produces an
explicit unavailable state rather than a partial or invented page.

Source and demo labels remain visible on cards and details. Public-source records
carry the non-participation/endorsement disclaimer, source name/URL and source
timestamps when present. A source timestamp does not establish current service
availability. Resource contact/hours/eligibility and public volunteer descriptions,
areas, capabilities and languages come from the public response. Exact addresses,
personal points, raw diagnostic messages and unknown response fields are omitted.

## Area search without GPS

The app declares no location permission and calls no GPS API. A ZIP is a
five-character string, preserving leading zeroes. A county can be entered with
its state name (for example Cook County, Illinois); ambiguous/unsupported input
fails before a request is sent. Selecting both ZIP and county is rejected.

Gradle bundles the repository's maintained Census 2020 postal, county and name
indexes directly as generated assets. There is no second editable geography
copy. ZIP feed filtering uses `postalCode`; county feed searches and resource
area searches use the public area's representative point and a bounded radius.
They are nearby searches, not county-boundary membership tests or personal
coordinates. Volunteer/organization APIs have no area filter, so those controls
are absent there. Denying device location does not affect any of these paths.

## Bounded offline behavior

Only explicit `PublicCard`/`PublicPage` fields are serialized into
`cacheDir/public-discovery-v1`. Raw HTTP JSON is never persisted. Cache keys hash
the API base, route and all applied query/page/dataset parameters. Public fields
are limited to at most 20 pages of 256 KiB each (5 MiB total). The latest write
is retained while older pages are evicted. Temporary writes are atomic within
this cache and synchronized across requests; a storage failure cannot turn a
successful online response into an error.

A snapshot is usable only before 24 hours from its original fetch time.
Clock rollback, future timestamps, corrupt/oversized records and expired entries
are rejected; expired/corrupt records are deleted when read. Network/service
failure can show a valid snapshot with an explicit stale banner and original
fetch time. Fallback never refreshes the timestamp or silently returns an empty
success. Missing/expired cache yields a localized error. Invalid user queries
and missing resources are not hidden by cached success. Responses over 512 KiB
are rejected before decoding; native organization pagination avoids downloading
an entire catalog. Fresh public detail reads remain separate from stale lists.

The OS may clear this public cache. There is no offline outbox, automatic write,
translation service, private content cache or simulated successful member action.
Dates use the device's regional settings/timezone independently of app UI
language, as required by the native localization foundation.

## Verification and limits

On Kvant, 2026-11-16 UTC, the deterministic tests cover:

- All server-owned feed goldens and new resource/volunteer/organization examples,
  legacy defaults, additions and unknown states.
- The named anonymous HTTP discovery journey, stale maintenance/error fallback,
  24-hour expiry, byte/count bounds, query isolation, and private-field canaries.
- ZIP/county lookup, leading zeroes, invalid input before network access,
  server-owned pagination and linked-resource dataset propagation.
- Production presenter/handler fixtures and optional organization pagination in
  disposable PostgreSQL, including stable disjoint pages and legacy web responses.

Final local checks passed: 13 discovery unit tests plus the configuration test
in each of Debug and Staging, Debug lint, both app APKs, instrumentation APK
compilation, 22 server unit/HTTP/fixture tests, four disposable PostgreSQL tests,
the API typecheck, 20 localization tests, resource validation and diff checks.
Review found the unbounded organization response and lost linked-resource
dataset; both were fixed and receive focused regression coverage.

The compiled UI suite adds public list/detail navigation, demo/stale labels,
unknown states, search/page controls without location permission, and distinct
loading/empty/maintenance screens. Shell localization layout tests inject their
own static discovery content so layout probes do not depend on HTTP timing.

The shared emulator crashed with SIGSEGV during the sign-in slice in this same
session. Its prescribed diagnostic retry also exited on signal 11 after boot;
no further device attempts were made. This PR remains a draft until its native
UI suite and interactive public-discovery/offline/language journey pass on an
acquired stable device. HTTP/unit/build results are separate from that gate.
No physical phone, real member journey, deployment or release signing is claimed.

Run the focused checks from the repository root:

```sh
rtk proxy env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ANDROID_HOME=/home/onnwee/Android/Sdk apps/android/gradlew -p apps/android \
  --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx768m \
  :app:testDebugUnitTest :app:testStagingUnitTest :app:lintDebug \
  :app:assembleDebug :app:assembleStaging :app:assembleDebugAndroidTest
rtk proxy npx vitest run services/api/src/native-discovery-wire-contracts.test.ts \
  services/api/src/mobile-wire-contracts.test.ts services/api/src/http/organization-handler.test.ts
rtk proxy node scripts/test-database.mjs services/api/src/native-discovery-paging.postgres.test.ts \
  services/api/src/organization-service.postgres.test.ts
rtk proxy npm run typecheck -w @patchwork/api
rtk proxy python3 -B scripts/check_android_localization.py
```

After acquiring a stable device, run `:app:connectedDebugAndroidTest` with its
current `ANDROID_SERIAL`. Use the returned `agent-device` command for interactive
launches, input, settings and screenshots. No provider credentials are needed
for this anonymous public-discovery slice.
