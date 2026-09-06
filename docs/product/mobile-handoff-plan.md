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
