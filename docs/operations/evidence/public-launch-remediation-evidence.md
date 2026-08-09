# Public-launch remediation evidence register

Status: **local implementation and verification complete; protected staging and independent approvals remain outstanding. No public-launch approval is implied.**

This register separates repository changes from a deployed, human-approved
launch decision. It replaces neither the protected-pilot readiness evidence nor
the legal and operational review records.

| Gate | Evidence added by this remediation | Current truth boundary |
| --- | --- | --- |
| Durable API integration | CI now migrates API, indexer, and moderation schemas and runs their explicit PostgreSQL suites plus the real attachment-provider suite | Disposable local PostgreSQL migrations and suites passed; protected CI and the real attachment-provider suite still require an actual run |
| OAuth/AT request projection | Existing real staging two-account lifecycle test is retained | Requires protected PDS/OAuth states and an actual staging run |
| Two-account coordination | New non-intercepted staging suite creates, projects, offers against, declines, and deletes its own disposable request | Requires two disposable test accounts and protected coarse discovery coordinates |
| Groups and chat | New non-intercepted staging suite creates a group, accepts an invitation, sends/redacts a message, and closes the group | Cleanup leaves expected audit records; the run is not yet evidence until CI retains it |
| Verification and notifications | New suite performs authenticated durable reads only | No verification decision, email delivery, or push delivery is claimed; those need approved fixtures/providers |
| Maintenance | New suite reads status and optionally performs a guarded declare/resume drill | The destructive state transition is disabled by default and needs an announced isolated staging window and a fresh maintainer OAuth state |
| Browser security | Storage states remain environment secrets; artifacts pass the existing redaction check | Review artifact-retention and secret scopes before enabling credentials |
| Legal and policy | No document or review state is fabricated | Terms, privacy, community, and acceptable-use policies remain subject to named independent legal/privacy review and formal effective-date approval |
| Accessibility and language | No certification is fabricated | Independent assistive-technology/WCAG and professional Spanish reviews remain external launch blockers |
| Operational ownership | No staffing assertion is fabricated | A distinct secondary responder, human game day acknowledgment, production capacity authority, and live backup/provider exercises remain required |

## Frontend post-remediation record — 2026-08-08

Baseline source: `0c2aed9eec515b9d4bc5f52fab3e76e2452994f7` on
`codex/public-launch-remediation` (local worktree; changes not committed or
deployed by this record).

| Finding / control | Local implementation evidence | Status boundary |
| --- | --- | --- |
| Responsive secondary navigation | One controlled disclosure now closes on Escape, outside click, route selection, and history navigation. Mobile presents inline labelled route groups without a nested popover. `navigation-geometry.spec.ts` passed at 320, 360, 390, 768, and 1024 CSS pixels and at 200% text sizing; Chat navigation and desktop foreground hit-testing passed. | `VERIFIED_LOCAL` |
| Public posting location | The web posting module consumes the canonical `@patchwork/at-lexicons` aid-post schema, enforces `PUBLIC_MIN_PRECISION_KM`, derives location from the confirmed approximate area, and exposes no mutable coordinate or precision fields. English and Spanish summaries describe public 1 km-or-coarser precision. Unit schema validation and the mocked production attachment/posting browser path passed with `precisionKm: 1`. | `VERIFIED_LOCAL` |
| Pagination focus and announcements | Feed, Map, Resources, and Volunteer share the same focus decision helper. Browser evidence covers Feed page 1 to 2, appended-range announcement, final-page status focus, URL history/Back restoration, and Volunteer Back restoration. | `VERIFIED_LOCAL` |
| Duplicate record-action names | Report, block, lifecycle, timeline, close, and delete labels include localized rendered position and list total. English/Spanish unit checks and same-title Feed browser assertions passed. | `VERIFIED_LOCAL` |
| Push revoke zero state | No production behavior change was required. Browser assertions passed for disabled at zero, enabled after registration, and disabled after revocation. | `VERIFIED_REGRESSION_LOCAL` |
| PW-IR-006 legal/policy approval | No policy text, effective date, draft banner, or approval state was changed. | `BLOCKED_EXTERNAL` — public release remains `NO-GO` |

Verification outcomes:

- `npm run check`: passed; 1,038 tests passed and 118 service-dependent tests
  skipped, plus map, exact-location absence, release-trust, release-state,
  backup-replication, and sprint-traceability checks.
- Full web Chromium: 159 passed and 2 protected non-mocked staging journeys
  skipped because credentials were not supplied.
- Focused remediation Vitest: 42 passed. Focused navigation, notifications,
  posting, Feed pagination, and Volunteer pagination browser coverage passed.
- `npm run build -w @patchwork/web`: passed. Built assets were
  `assets/index-Ds64aG9J.js`, `assets/index-BILdm333.css`,
  `assets/InteractiveMap-DHNYp9JO.js`, and
  `assets/InteractiveMap-CIGW-MKW.css`. The 701.05 kB main JavaScript chunk
  retains the existing non-blocking size warning.
- `npm run test:e2e:redact` and `git diff --check`: passed.

These outcomes prove the local source, tests, and generated production bundle.
No immutable image digest, controlled pre-alpha deployment, `/api/health/ready`
result, deployed source SHA, or post-deploy Chrome acceptance evidence was
produced in this implementation run.

## Local verification record — 2026-08-07

- `npm run check`: passed; 1,034 tests passed and 118 service-dependent tests
  skipped, with map, exact-location absence, release-trust, release-state,
  backup-replication, and sprint-traceability checks also passing.
- `npm run test:e2e -w @patchwork/web -- --reporter=line --workers=1 --retries=0`:
  154 Chromium cases passed and the two protected, non-mocked staging journeys
  skipped because no credentials were supplied.
- `npm run test:coverage`: passed; 43.03% statements, 34.13% branches, 38.02%
  functions, and 44.22% lines. Coverage is diagnostic, not a launch approval.
- Disposable PostgreSQL 16 verification: all 25 API, 6 indexer, and 5
  moderation migrations applied; API persistence/HTTP integration passed 77
  tests, direct lifecycle integration passed 8, indexer passed 52, and
  moderation passed 71. The temporary container was removed afterward.
- `npm run build`: passed. The web build retains a non-blocking warning for a
  698.96 kB main JavaScript chunk.
- Playwright artifact redaction, workflow YAML parsing, `git diff --check`, and
  `npm audit` passed; the audit reported zero known vulnerabilities.

These are source-worktree and mocked-browser results. They do not demonstrate a
deployed staging image, PostgreSQL/provider execution for skipped suites, live
AT/OAuth workflows, or production behavior.

## Required release record after an actual staging run

Attach, without secrets or storage states:

- source commit and immutable deployed image digests;
- CI workflow URL and the two browser-suite outcomes;
- redaction-check outcome and retained artifact policy;
- the disposable fixture namespace/record URI (not private content);
- cleanup outcome, including whether a maintenance drill was deliberately
  enabled;
- links to independently signed legal, privacy, security, accessibility, and
  translation reviews when available.

Until those items exist and the external approvals are recorded, the correct
decision remains **NO-GO for public traffic**.
