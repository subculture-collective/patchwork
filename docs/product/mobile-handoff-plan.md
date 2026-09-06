# Verified mobile handoff implementation

Approved 2026-09-05. Baseline: `5b348af`. Worktree: `patchwork-mobile-handoff`, branch `codex/mobile-handoff`. Preserve the original checkout's seven dirty documentation files and output directory.

## Decisions and success criteria

Retain Patchwork's visual identity; rebuild flows. Separate demo content from community discovery. Validate in a protected isolated candidate stack. Require an uncoached real handoff on iPhone Safari and Android Chrome, reversing participant roles. This is not public-launch approval. Preserve offer identity privacy, owner/moderator-only lifecycle detail, accepted-participant connection permissions, approximate public coordinates, and explicit optional exact-location consent.

## Ordered work

- [ ] Phase 1 / F01: authoritative permission-aware mutations, shared pending/error/idempotency/readback, public-sync receipts.
- [ ] Phase 1 / F02: functional resource contacts; contextual View location; community request instead of fake native intake; safe synthetic behavior.
- [ ] Phase 1 / F11: durable authoring receipts, actionable publication states and retries, localized errors.
- [x] Phase 1 / F12: repair five browser fixtures and test missing-location/count contract independently.
- [ ] Phase 2 / F03: public shared request detail, direct offer, contextual acceptance and handoff workspace.
- [ ] Phase 2 / F09: safe complete auth return, tab-scoped 24-hour drafts excluding exact coordinates/attachment bytes/credentials, direct posting geolocation, policy links.
- [ ] Phase 2 / F10: visible chat polling 3 seconds, activity 15 seconds; pause hidden, refresh focus/online, backoff and stable retries.
- [ ] Phase 2 / F15: independent email/push configuration, contextual notification destinations and real designated-recipient verification.
- [ ] Phase 3 / F04-F08: Nearby/Ask/Resources/My activity; map/list split or mobile switch/detail sheet, explicit area search, counts/layers/origin parity, separate demo mode.
- [ ] Phase 3 / F12-F13: authoritative SQL filtering/order/pagination; unlocated records excluded from nearby but allowed in unbounded latest; map aggregates from privacy-safe display coordinates.
- [ ] Phase 3 / F14: extract route modules, shared query/action state and lazy secondary surfaces; <=200KB gzip main JS.
- [ ] Phase 4: isolated candidate containers/DB/objects/network/credentials; coherent source-labelled immutable image manifest and tiles; dependency remediation; integration and browser qualification.
- [ ] Phase 4: 10k requests/1k resources, 5min 40 aggregate read RPS under controlled lifecycle, no unexpected 5xx/restarts, p95 discovery <=500ms, projection <=30sec, foreground chat <=5sec.
- [ ] Phase 4: isolated DB/object restore and rollback/forward; document independent-backup/staffing/review gates honestly.
- [ ] Human milestone: two real phones, two role-reversed uncoached real-service journeys with designated accounts and agreed handoff; record evidence and cleanup.

## Interfaces and compatibility

Canonical UI `/nearby?view=list|map`, `/requests/view?uri=…`, `/resources?resource=…`, `/activity?connection=…`, `/posting`; preserve `/map`, `/feed`, `/inbox` aliases with context. `dataset=community|demo`, default community, enforced in API and eligibility. Public-safe `/query/aid-post?uri=…` and `/query/directory-resource?uri=…`; authenticated paginated `/account/requests` including receipts before projection. Extend existing map responses with aggregates and layer counts, retain paginated fields. Existing command APIs and AT lexicons retained. Additive receipts/display-coordinate/index migrations only, with retention/export/deactivation coverage.

## Verification and boundaries

Run focused meaningful regressions, full source/build, disposable PostgreSQL and real attachment integration, browser suite without new skips, Chromium/WebKit mobile accessibility/English/Spanish. Credentialed live journeys and human phone exercises are separate from mocked checks. Artifact upload requires actual redaction terms. Public release additionally requires independent reviews, independent durable recovery, secondary responder/human acknowledgment, accepted moderation/support ownership and stewarded community content.

## Execution notes

2026-09-05: fetched both remotes, created isolated worktree, dependency installation started. Original checkout preserved. Implementation began after dependency installation; the status below supersedes this initial checkpoint.


## Implementation checkpoint — first delivery tranche

Implemented on `codex/mobile-handoff`, without changing or deploying the original checkout:

- **F01:** shared owner-only map/feed request actions use server-provided transitions and stable command keys. Public-sync errors retain a retry action while discovery refreshes; durable pending/failed sync state is read again on mount. Anonymous visitors receive no lifecycle controls.
- **F02:** resource details now offer validated website/telephone contacts and directions only to unexpired approved public addresses. Example listings cannot contact or submit intake. Community request links carry resource context. Approximate resource areas are rendered on the map, and selecting one opens the corresponding contact panel.
- **F03:** `/requests/view?uri=...` and `/query/aid-post?uri=...` provide shared public request detail with a direct offer form. The query is constrained to the requested URI and applies viewer blocks. Offer retries preserve the note and command key. The existing inbox remains the handoff workspace pending the planned activity redesign.
- **F04:** map viewport changes no longer implicitly replace search filters. “Search this area” commits a new search; history behavior has a browser regression. The duplicate map overview and mobile sheet redesign remain outstanding.
- **F09/F11:** sign-in links preserve the full safe return path; resource context survives URL synchronization. Posting text drafts are tab-scoped and expire after 24 hours, excluding coordinates, attachment bytes and credentials. Publication checks expose retry after missing/exhausted confirmation. Creation retries retain their key/time, and attachment retry stays on the accepted request. These are browser-side improvements; durable authoring receipts remain outstanding.
- **F10:** active-chat receiving refreshes every three seconds with visibility/offline suspension, bounded failure backoff and older-history preservation. Chat workspace refreshes every 15 seconds. This is automated receiving coverage, not proof of real-device delivery latency.
- **F12:** repaired the five originally failing browser cases with geographically consistent fixtures and authoritative lifecycle responses. Added independent latest/nearby missing-location contract tests; latest does not implicitly reuse a stored nearby center.
- **F14:** request details, chat and groups are separate lazy chunks. The current initial JavaScript is 195,819 gzip bytes (709,004 uncompressed), below the 200,000-byte budget. Broad route extraction is not complete.
- **F15:** email and push instantiate independently. Production requires at least one complete delivery channel and rejects partial configuration for an enabled channel. Actual recipient delivery remains unverified.

### Verification recorded so far

- Repository `npm run check` passes: 1,065 tests pass with 125 infrastructure-dependent skips, plus localization and operational scripts. Database-backed reruns are recorded separately below. `git diff --check` also passes.
- Web unit suite: 279 tests pass after the additional missing-location contract.
- All five previously failing browser cases pass with `--retries=0`.
- Disposable PostgreSQL 16: API/indexer/moderation migrations applied. Full API suite with PostgreSQL: 415 pass, one real-attachment-infrastructure test skipped. The designated API PostgreSQL integration command separately passes all 78 tests. Indexer: 64 pass; moderation worker: 71 pass. The disposable database was stopped and removed after verification.
- New public-detail database tests cover URI validation, missing records, public-only fields and blocked-viewer denial. New browser tests cover anonymous auth context and idempotent offer retry.
- Full browser run on the final implementation: 161 passed, two existing credential-dependent skips, and one map test failure caused by force-clicking a deliberately hidden radio input. After correcting the test to click the visible label, the remaining map search/history/style test passed without retries (3.6 seconds). This is a full run plus a focused correction, not a subsequent all-green full run.
- No production mutation, public promotion, real email send, human phone test, load qualification or restore drill has been performed.

### Remaining delivery sequence

1. Finish durable authoring receipts and `/account/requests`, including retention/export/deactivation and truthful projection readback after reload. Complete resource lookup independent of the currently loaded page.
2. Build the focused activity/handoff workspace: contextual offers, acceptance, chat, scheduling, completion/cancellation and notification destinations; finish posting location access and recovery. Verify real designated notification recipients.
3. Deliver the full Nearby/Ask/Resources/My activity navigation and mobile map/list/detail-sheet design. Enforce community/demo datasets and eligibility server-side. Replace full-projection reconstruction with bounded SQL filtering/pagination and privacy-safe spatial aggregates; extract remaining routes.
4. Build and qualify the protected isolated candidate: dependency remediation, immutable provenance, real attachment integration, mobile WebKit/Chromium, capacity/projection/chat latency, recovery and rollback checks.
5. Run the two role-reversed uncoached iPhone Safari/Android Chrome handoffs. Participants/accounts and the designated email recipient have been requested. Public launch retains the independent review, recovery, staffing and community-content gates above.

This checkpoint is working implementation progress, not completion of the mobile-handoff milestone or release authorization.


## Implementation checkpoint — durable ownership and direct resource lookup

2026-09-05, continuing from `1f7db32`. Both remotes were fetched again; `origin/main` and `github/main` remain `5b348af`. The original checkout's dirty documentation and output remain untouched.

- **F01/F11:** successful AT request commands now persist minimal authoring receipts in the same PostgreSQL transaction as their idempotent acknowledgment. Initial creation also registers its private workflow immediately. Receipts retain URI/owner/title/CID/status/timestamps, without descriptions, coordinates, attachment bytes or credentials. They participate in account export, deactivation and 365-day retention. The migration conservatively recovers recent prior acknowledgments; an actor's intervening successful deletion suppresses ambiguous older recovery because the old replay ledger contains no deletion URI. Existing projections and workflows are also included in account reads.
- **F11:** authenticated `GET /account/requests` derives ownership from the session and provides stable 20-item pages, including preprojection receipts. The new lazy My requests panel preserves accepted requests across refresh/navigation, exposes owner actions before indexing, and distinguishes pending/public versions. Publication readback compares the actual indexer CID against the latest source receipt; a successful source acknowledgment alone is no longer labelled projected.
- **F02:** `GET /query/directory-resource?uri=...` loads one resource independently of current result pages, geographic filters or category filters. `/resources?resource=...` now opens that resource near the top of the page with loading/error/retry states. Phone-only resources can open without invented coordinates. Exact-address enrichment is limited to returned resources and retains all current verification, stewardship, confidentiality and expiry gates.
- **F03/F10:** existing activity sections now refresh independently, retain usable results through unrelated discovery failures, clear affected private data on authentication failure, and poll while visible every 15 seconds. Request-specific links scope offers/connections to their request. The larger focused workspace/navigation redesign remains next.

Verification:

- `npm run check` passes: 1,065 unit/source tests pass, 135 infrastructure-dependent cases skip in that command, and map, exact-location absence and operational scripts pass. The database reruns below cover the database-dependent skips. English/Spanish lifecycle labels additionally pass all 38 localization tests.
- Fresh disposable PostgreSQL 16: all 27 API, eight indexer and five moderation migrations apply. Full database-enabled suites pass: API 425 passed / one real-attachment-infrastructure test skipped; indexer 64 passed; moderation 71 passed.
- Nine new receipt regressions exercise ownership, restart/replay, source version mismatch, pending synchronization, rollback on invalid acknowledgment, stable paging, legacy recovery, deletion suppression and retention. Account privacy tests verify receipt export and subject-only deletion.
- Resource database coverage includes direct lookup outside search filters, phone-only services, invalid/missing URIs and expiration of public-address approval.
- Full Chromium browser suite with `--retries=0`: **164 passed, two existing credential-dependent skips, no failures** (3.2 minutes). This includes 390px recovery/resource cases and the existing two-account coordination, exact-location and verification journeys. These are local mocked browser checks, not real-phone or live-provider qualification.
- Initial JS: 197,801 gzip bytes (713,931 raw bytes; gzip level 9), below the 200,000-byte budget. No public deployment, real recipient send, load qualification, restore drill or human phone test was performed.

Remaining sequence now starts with the focused activity/handoff workspace, direct posting location and notification destinations, then full navigation/map UX, dataset separation, SQL paging/aggregation, route extraction and protected candidate qualification. A source-write/DB-commit failure still spans two systems; receipt transactions do not establish an atomic PDS/PostgreSQL commit. Real recipient and phone participants remain unconfirmed.

## Implementation checkpoint — contextual handoff and posting recovery

The second tranche now keeps the selected handoff through chat, scheduling and notification links. Explicit unknown conversation targets never silently open another conversation. Accepted connections expose message and scheduling actions; request titles link back to public context. Authentication failures clear affected private views.

Posting now requests approximate browser location within the form, retains text through denial, and offers an explicit Cook & DuPage fallback with 50 km source precision. Granted coordinates are rounded before submission. Acceptance and completion preserve their idempotency keys after uncertain failures and disable overlapping actions.

Verification: repository checks pass (1,065 passed, 135 infrastructure skips); the database-enabled API suite passes 425 cases with one real-attachment skip. The full Chromium run completed with a passed last-run record and no failed tests (171 enumerated cases, including two credential-dependent skips). Added browser cases cover explicit conversation/connection targeting, unknown-target isolation, actual posting with granted/denied location, and acceptance/completion retries. Notification database checks verify contextual destinations and absence of private message bodies. Initial JS is 198,426 gzip bytes (716,908 raw, gzip level 9).

This remains local implementation and automated qualification. Real recipient delivery, the navigation/map redesign, server dataset enforcement, bounded SQL discovery, protected candidate qualification and human phone handoffs remain outstanding.

## Implementation checkpoint — everyday navigation and mobile map details

2026-09-06, continuing from `b6f543c`.

- Main navigation now exposes Nearby, Ask, Resources and My activity, including on narrow phones before the account menu opens. Nearby has explicit List and Map views. Canonical URLs are `/nearby?view=list|map` and `/activity`; incoming `/feed`, `/map` and `/inbox` aliases retain query context and canonicalize with history replacement. Back does not get trapped on an alias. Modified link clicks retain native browser behavior.
- The map remains one Leaflet instance using the existing PMTiles basemap and privacy-safe overlays. Leaflet owns camera state; React owns discovery filters and selected details. Panning still requires “Search this area” to change the active query. Existing approximate request areas and approved resource-address rules are unchanged.
- Removed the redundant cluster-summary card. The readable request list remains available, and the long filter panel is disclosed under Location and filters. Request and resource selection are mutually exclusive. Selected details appear in a non-modal, scrollable sheet with a visible close control; narrow screens anchor it to the bottom with a bounded height. Keyboard opening focuses Close, Escape dismisses, and closing restores the connected initiating element. The sheet does not claim modal focus trapping.
- Public UI wording now uses View request and Request details in English and Spanish. Demo/community URL context survives list/map navigation; this is not the outstanding server-side dataset enforcement.

Remaining map/navigation scope: selected-record restoration from URLs independently of loaded pages; the larger focused activity layout; real-device gesture/tile/offline qualification; bounded SQL discovery and aggregate counts across all matching results. Existing map counts still describe loaded records, not a newly implemented complete aggregate. Route extraction is urgent: the current initial JS is 199,112 gzip bytes (718,142 raw, gzip level 9), below but close to the 200,000-byte budget.


Verification for the navigation/map tranche:

- Final repository check passes: 1,065 tests pass and 135 infrastructure-dependent cases skip, plus map artifacts, exact-location absence and operations checks. Database-enabled results from the previous checkpoint still apply to the unchanged backend.
- The full Chromium run passed 171 cases and skipped two credential-dependent cases. It exposed one map clear-area failure: automatic geolocation could restore a deliberately cleared area. The final fix treats an initially supplied area as satisfying automatic discovery; a user can explicitly request location again.
- After that fix, all 24 navigation, map, production-mode and feed-pagination browser regressions pass with `--retries=0` (17.3 seconds). This is a broad run followed by a verified correction, not a subsequent all-green full run. The browser regression covers 320–1024px navigation, 200% text, canonical aliases, Back/Forward, dataset context, focus restoration, and populated 390px detail-sheet bounds. The mobile screenshot was also inspected.
- Both remotes were fetched again and still point to `5b348af`. The original checkout remains untouched. No public push/deployment, real recipient delivery or human phone handoff occurred; the disposable PostgreSQL container was stopped and removed.

The next implementation step is server-enforced community/demo separation and mutation eligibility, followed by bounded SQL discovery and route extraction. The broader activity layout and selected-map-record URL restoration are still open. Protected candidate qualification and the real-device milestone gates remain open.
