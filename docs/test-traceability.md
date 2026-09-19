# Patchwork layered test traceability

Updated: 2026-08-21

This document describes what each test layer actually executes. Test counts are reported by layer because fixture-heavy unit coverage is not equivalent to PostgreSQL, HTTP, browser, or live AT Protocol evidence.

## Test layers

| Layer | Purpose | Command | External dependency | CI location |
| --- | --- | --- | --- | --- |
| Domain/unit | Pure rules, validators, state machines, presentation helpers | `npm test` | None | `quality-gates` |
| Fixture service integration | Multiple in-process services using deterministic fixtures | `npm run test:integration:service -w @patchwork/web` | None | `e2e-production` |
| PostgreSQL integration | Migrations, persistence, restart, rollback, idempotency | `npm run test:integration:postgres -w @patchwork/api` | PostgreSQL 16 and `TEST_DATABASE_URL` | `e2e-production` |
| HTTP/PostgreSQL integration | Real Node HTTP server, cookies, JSON boundary, durable lifecycle state | Included in API PostgreSQL integration | PostgreSQL 16 | `e2e-production` |
| Browser E2E | Rendered web application, focus, keyboard, landmarks, ARIA | `npm run test:e2e -w @patchwork/web` | Playwright Chromium | `quality-gates` |
| Diagnostic coverage | Finds unexecuted production code; no arbitrary global threshold | `npm run test:coverage` | None | `quality-gates`, uploaded artifact |
| Local HTTP capacity probe | Paces completed GET requests; records status, throughput, p50/p95/p99; optionally enforces budgets | `npm run capacity:probe` | Configured running API; PostgreSQL used for current evidence | Manual isolated/staging evidence |
| Account data export | Session-derived subject, repeatable PostgreSQL snapshot, cross-subject and credential exclusion | Included in API suite | PostgreSQL 16 and `TEST_DATABASE_URL` | Local HTTP evidence; policy review still required |
| External AT protocol | Disposable accounts against the staging PDS | Manual controlled exercise | Home-network staging PDS | Redacted evidence only |

## Current verified baseline

At `00559d8`, `npm test` passed 1,047 tests and skipped 122 tests because the
required PostgreSQL or provider services were not configured. `npm run
typecheck` and `npm run test:operations` also passed. The operations check
verified eight stories and 40 protected-pilot criteria. This local result does
not replace the dated integration, browser, or deployment evidence below.

The first six rows are the local remediation run from 2026-08-07. The external
AT protocol and capacity rows retain earlier controlled-environment evidence
and must not be read as a fresh staging run of this worktree.

| Layer | Result |
| --- | --- |
| Repository local aggregate | 1,034 passed; 118 PostgreSQL/provider-dependent tests skipped because their required services were not configured for the local run |
| Direct lifecycle service integration | 8 passed in the 2026-08-07 remediation run |
| API suite with PostgreSQL and HTTP boundary enabled | 77 passed in the 2026-08-07 remediation run |
| Indexer suite with PostgreSQL projection/reconciliation enabled | 52 passed in the 2026-08-07 remediation run |
| Moderation suite with PostgreSQL enabled | 71 passed in the 2026-08-07 remediation run |
| Browser Chromium suite | 154 local cases passed; 2 protected non-mocked staging cases skipped because credentials were not supplied |
| Diagnostic coverage without database suites | 43.03% statements, 34.13% branches, 38.02% functions, 44.22% lines |
| External AT protocol | Aid two-account OAuth/create/discover/report/block/resolve/close/delete passed in Chromium; directory create/update/discover/delete passed in a controlled browser exercise |
| Local PostgreSQL capacity probe | 1,150 requests, 0 errors; four modeled read budgets passed over 1,000 generated projections |

Counts can change as tests are consolidated. Readiness depends on covered boundaries, not the aggregate.

## Critical behavior matrix

| Capability | Domain/unit | Fixture service | PostgreSQL | HTTP | Browser | External AT | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AT OAuth adapter | OAuth adapter plus stable denied/state-error mapping | Cookie-only AuthProvider and API client | OAuth state/session restart tests | Login JSON/redirect, sanitized callback, session/refresh/logout routes | Login/callback recovery, keyboard, labels, live regions | Two disposable browser callbacks completed against the home PDS | Deployment-secret rotation and protected staging automation |
| Aid-post repository CRUD | Lexicon and record-client tests | Command service tests | Session persistence only | Command route tests | Posting form, API-client tests, and the external lifecycle journey | Two-account browser lifecycle evidence | Protected automated disposable-account provisioning/cleanup |
| AT wire encoding | Integer coordinate adapter tests | — | — | — | — | Live staging PDS accepted records | Other custom record families |
| Lifecycle rules | `packages/shared/src/lifecycle.test.ts` | `lifecycle-service.integration.test.ts` | Restart, retry, rollback, audit, assignment/handoff, deletion, role, public-sync state, and stream reconciliation | Authenticated owner-only lifecycle reads plus durable transition HTTP | Alpha shell loads private state, sends no browser actors, reconciles AT status, and exposes retryable partial failure | Live stream status/delete reconciliation completed in the two-account journey | Protected staging repetition and operator role provisioning |
| Blocks and reports | Service and typed client validation | Older chat safety fixtures are unavailable in production | Repository retention/deletion, bilateral discovery filtering, chat access termination, and body-free chat-report evidence | Authenticated session-derived report/block/chat actors use idempotent JSON routes; expired sessions fail closed | Rendered report/chat controls, confirmation, retry, and safe errors | A helper reported and blocked the live requester; cleanup retained one redacted safety receipt | Formal policy approval and protected staging repetition |
| Connection scheduling | Timezone and window validation | Legacy volunteer-shift fixture remains unwired | Versioned proposal/counter/confirm/cancel/expire/reminder state survives restart | Session-derived participant identity, idempotency, stale-version and conflict denial | Responsive bilingual scheduling journey with stale/conflict/keyboard/axe checks | No external calendar integration | Professional translation and protected staging review |
| Groups | Role/invitation/room schemas | Legacy in-memory service is not imported by production | Ownership, hashed invitation, request-intersection, removal, export, deactivation, and restart journeys | Session-derived identity and idempotent group routes | Owner create/invite/room journey at 320px/200% with axe | No external group authority | Independent security/privacy/accessibility/translation review |
| Bounded chat | Size, cursor, redaction, receipt, and report validation | Legacy `/chat/initiate` remains unreachable | Direct/group restart, dedupe, pagination, rate, block/removal, export/deactivation, and body-absence journeys | Session-derived identity and idempotent chat routes; body only in JSON mutation | Honest EN/ES trust disclosure, retry-ID stability, read/redact/report, offline draft, reflow, and axe | No external messaging provider | Protected staging and independent review; not E2EE |
| English/Spanish runtime | Key parity, interpolation, and raw-JSX AST scan | — | Account language preference persists | Authenticated preferences apply server notification language | Every production route scanned in EN/ES for copy, lang, reflow, and axe; switching preserves form/URL state | Professional translation not performed | Professional translation review remains a launch gate |
| Discovery | Jetstream v1/v2 source, v2 bounded backfill, projection comparison, ranking, discovery rule, data-mode, and typed API failure tests | Local demo fixtures require explicit fixture mode | Cursor, heartbeat, normalized aid-post projections, tombstones, dead letters, v2 control state, and v1 rollback projections persist | Real PostgreSQL projection filters, pagination, freshness, and startup lag rejection | Map/feed UI, accessibility, API-unavailable visibility, and idempotent retry with no fixture substitution | Aid and directory records traversed the home PDS, local Jetstream, PostgreSQL, and browser before the v2 cutover | Protected-staging and live-PDS v2 replay/comparison evidence; partner verification administration |
| Moderation | Policy and queue state tests | Worker fixture services are test-only | Concurrent PostgreSQL queue, lease, audit, policy, and retention stores back production | Authenticated API-to-worker commands derive the actor from the session | Console UX remains deferred | No public external dependency | Staging alert/game-day execution and operator workflow |
| Privacy | Geo floor and redaction tests | Fixture response checks | Audit payload redaction and scheduled retention | HTTP boundary avoids actor override | Accessibility and artifact redaction | Redacted lifecycle evidence | Formal policy approval and staging observation |
| Account access/deactivation | Response schema, browser client, durable account suppression | Deferred preference controls remain fixture-development only | Subject-owned export; deactivation removes Patchwork state and suppresses replay/login | Cookie-derived DID; export GET and deactivation POST carry no body identity | Production Settings JSON export; explicit confirm/cancel; CSRF-protected empty-body deactivation; revoked-session state | Full AT repository remains portable outside Patchwork | Controlled reactivation, AT-repository deletion, casework review, and formal privacy approval |

## Suite ownership and classification

### Domain and unit suites

- `packages/shared/src/*.test.ts`: retained alpha domain rules and deterministic models.
- `packages/at-lexicons/src/lexicons.test.ts`: local JSON lexicon loading and validation.
- `packages/at-client/src/*.test.ts`: official AT SDK adapter behavior and stable error mapping.
- `apps/web/src/*.test.ts(x)`: UX models, API client parsing, accessibility helpers, and component rendering.
- `apps/mobile`: contract-only source is typechecked; its prototype tests were removed from the alpha gate.
- `services/*/src/*.test.ts`: service behavior, including many fixture-backed models.

### Direct service integration

`apps/web/e2e/lifecycle-service.integration.test.ts` imports API service factories directly. It verifies cross-service lifecycle and feedback behavior, but deliberately does not claim HTTP, authentication, process, or database coverage.

### PostgreSQL and HTTP integration

The mandatory API integration command runs:

- `services/api/src/auth/session-repository.postgres.test.ts`
- `services/api/src/db/core-operational-state.test.ts`
- `services/api/src/http/lifecycle-transition-handler.postgres.test.ts`

These tests require `TEST_DATABASE_URL`. They verify encrypted OAuth persistence, browser-session revocation, migrations, restart survival, command idempotency, transaction rollback, audit redaction, subject deletion, HTTP parsing, session-derived identity, ownership denial, and server restart/readback.

### API transport security

`services/api/src/http/router.test.ts` verifies method/path resolution and the
known-path versus unknown-path distinction. `api-server-routing.test.ts` opens a
real loopback HTTP server and proves that an unsupported method returns `405`,
an exact `Allow` header, and the public error envelope. Later Phase 4 slices add
authenticated-principal, body-parser, CSRF, perimeter, and shutdown coverage.
The same server suite now covers malformed JSON, unsupported media type, and
one-mebibyte rejection; `error-response.test.ts` proves unknown exception text
is replaced rather than serialized.
`authenticated-request.test.ts` covers bearer and cookie parsing, missing and
conflicting credentials, single session/role resolution, and deep immutability.
The lifecycle PostgreSQL HTTP suite covers missing and expired sessions plus
authorization derived from the durable role instead of hostile body fields.
`graceful-shutdown.test.ts` uses a real Node server to prove immediate refusal
of new connections, active-request drain, pool-close ordering, and idempotency.
`perimeter.test.ts` verifies restrictive security headers, production HSTS,
double-submit CSRF validation, constant-origin policy, and Secure/Strict CSRF
cookie attributes. The live server suite proves middleware rejection and header
emission on an actual HTTP response.
`rate-limiter.test.ts` proves policy selection and exhaustion/reset behavior,
plus exact-IP/subnet proxy trust and spoofed forwarded-header rejection.
`cors.test.ts` proves rejected origins receive neither wildcard nor credential
permission and accepted origins receive explicit credential permission.
`query-string-security.test.ts` scans the API and moderation runtime entrypoints
and fails if fixture `FromParams` routes, moderation URL-body parsing, or
sensitive query keys return. Worker live HTTP coverage proves the former query
mutation is now `405` and the JSON route refuses fixture persistence.
`moderation-gateway.test.ts` proves the API forwards its service credential and
session-derived actor while stripping hostile actor fields. Worker live HTTP
coverage proves credential rejection; its PostgreSQL branch proves the durable
audit actor came from the authenticated gateway header.
`idempotency-store.postgres.test.ts` proves concurrent execute-once behavior,
durable response replay after reconstruction, canonical payload matching, and
conflicting-key rejection against PostgreSQL.
`idempotent-request.test.ts` proves header validation and hostile body-command
replacement. The lifecycle PostgreSQL HTTP restart test exercises the wired
ledger, `record-client.test.ts` proves deterministic PDS create uses the same
record key, and the web API-client test asserts mutation header generation.

### Browser E2E

`apps/web/e2e/accessibility.spec.ts` starts the Vite web application and runs in
Chromium. It verifies skip links, landmarks, keyboard operation, Escape
behavior, labels, ARIA semantics, focus management, route announcements, image
alternatives, 320-pixel reflow, 200% text sizing, and reduced-motion behavior.
`production-data-mode.spec.ts` separately rejects fixture content and
unsupported capability claims in the production shell and exercises the
durable account Settings path.

### External protocol evidence

`docs/operations/evidence/phase-2/at-record-lifecycle.md` records the disposable two-account staging-PDS exercise. Tokens and passwords are intentionally absent. This evidence is valuable but manual and must not be counted as an automated test.

## Coverage interpretation

Coverage is diagnostic. The post-pruning drop is intentional: it exposes how much unshipped expansion source remains without alpha release protection. Retained gaps at important runtime boundaries include:

- `apps/web/src/features/frontend-shell.tsx`
- `services/api/src/http/lifecycle-transition-handler.ts` in the no-database coverage job
- PostgreSQL block/report/audit repositories outside the database job
- indexer checkpoint and metrics runtime paths

The Phase 5 source slice adds `jetstream-source.test.ts` and `runtime.test.ts`.
They use a real loopback WebSocket server to prove collection filters, durable
cursor resume, reconnect/redelivery after processing failure, duplicate and
out-of-order suppression, malformed and oversized rejection, shutdown without
reconnect, and final checkpoint persistence. These tests deliberately do not
claim durable projections or a public Jetstream exercise.

`db/projection-store.test.ts` adds PostgreSQL coverage for empty migration and
replay, privacy-safe create, update, stale and duplicate suppression, delete
tombstones, invalid-record quarantine, pipeline-before-checkpoint ordering,
rebuild equivalence, and database-outage redelivery. The diagnostic coverage
command omits database suites; the database-enabled full gate runs workspace
tests serially where required.

`query-service.postgres.test.ts` now uses PostgreSQL rather than mocking the
legacy event loader. It proves the API reads projection rows, filters by every
alpha discovery dimension, returns stable pages, and includes durable
freshness metadata. `query-service-readiness.test.ts` covers unavailable,
stale, and threshold-edge heartbeat policy. A startup acceptance command also
proved a current heartbeat initializes successfully and a one-hour-old
heartbeat fails the API's 300-second guard.

CI uploads `coverage/coverage-summary.json`, LCOV, and the HTML-compatible data needed by coverage tools. No global threshold is enforced until fixture-heavy code and production runtime code are separated into meaningful targets.

## Deferred expansion code

Tests for contract-only or fixture-only expansion systems were removed from the active repository on 2026-07-10. Their TypeScript remains subject to lint, typecheck, and build. A deferred feature must receive tests at the appropriate persistence and external boundary when it is selected for implementation; the old fixture corpus should not be restored wholesale.

## Phase 7 recovery operations

`packages/shared/src/recovery-operations.test.ts` ties the recovery scripts,
runtime metric emitters, and executable alert rules to the Task 7.3 contract.
The committed Phase 7 evidence records both the earlier disposable PostgreSQL
drill and the 2026-07-28 NUC exercises: live PostgreSQL 17 backup/restore,
session invalidation, source/private-state count comparison, restrictive
archive permissions, loaded Prometheus sources, and a routed
indexer-disconnect alert. Human acknowledgment and immutable signed-digest
deployment were external at the time of that recovery drill. Later on
2026-07-28, four zero-HIGH/CRITICAL images were published to the NUC registry,
verified against a scoped Cosign public key, deployed by exact digest, rolled
back as a set, promoted forward, and accepted by the real two-account browser
journey. Patrick Fanella is now the named interim home-staging primary on-call
and escalation owner. Human acknowledgment, a distinct secondary responder,
protected GHCR/OIDC execution, and independent durability remain external.

## Metrics-series integrity

The indexer checkpoint/metrics tests and moderation durable-queue tests compose
each domain SLI renderer with its real HTTP collector and require every emitted
Prometheus series to have a unique metric-and-label identity. Indexer ingestion
and moderation queue/action SLIs remain under `patchwork_sli_*`; their
administrative HTTP traffic is emitted under `patchwork_http_*`. This prevents
Prometheus from retaining only the first of two identically labelled samples
and hiding transport load during capacity or incident analysis.

## Staging capacity evidence

`staging-capacity.test.ts` prevents short or read-only benchmarks from
satisfying the capacity gate. It requires five minutes of mixed workload,
successful lifecycle projection and moderation resolution, complete cleanup,
bounded host/container/database use, zero request/ingestion/restart deltas, low
event-source lag, and ready post-workload recovery. The evaluator accepts only
redacted aggregate evidence; account identifiers, tokens, exact locations,
case details, and database connection strings are outside its schema.

## Private-data retention

`retention-service.postgres.test.ts` proves elapsed private deadlines delete
blocks, reports, audits, and workflows with cascading timelines while future
records remain. It also proves expired browser/OAuth state, old revoked OAuth
sessions, and completed HTTP replay entries are pruned without deleting active
sessions. Scheduler and metric tests cover immediate/repeated non-overlapping
execution, clean stop, and preservation of the last-success timestamp after a
failure. `moderation-retention.postgres.test.ts` independently proves the
worker-owned seven-day boundary: expired audits and resolved cases disappear,
while queued and recently resolved cases remain. Store tests prove policy
decisions assign exact deadlines and reopening clears the case deadline.

## Local full-matrix procedure

```sh
npm run lint
npm run typecheck
npm test

# With disposable PostgreSQL and TEST_DATABASE_URL configured:
npm run db:migrate -w @patchwork/api
npm run test:integration:postgres -w @patchwork/api
TEST_DATABASE_URL=postgresql://... npm test -w @patchwork/moderation-worker

npm run test:integration:service -w @patchwork/web
npx playwright install chromium
npm run test:e2e -w @patchwork/web
npm run test:coverage
npm audit --audit-level=high
```

The external staging-PDS exercise is intentionally separate from this routine and requires controlled disposable credentials.
