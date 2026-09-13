# Testing and quality gates

Tests protect public contracts and important user behavior. Prefer the smallest
layer that can demonstrate a regression, with one clear owner for each rule.
A file count or aggregate coverage percentage is not a readiness claim.

## Commands

| Command | Scope | Dependencies |
| --- | --- | --- |
| `npm run check` | Typecheck once, unit tests, map/privacy checks, operational scripts | Node, Docker CLI for Compose validation, shell tools |
| `npm run test:unit` | Pure domain rules, adapters, HTTP boundaries, component behavior | Node; Docker CLI for Compose validation |
| `npm run test:integration` | Fresh migrations, every PostgreSQL suite | Docker; creates and removes its own loopback-only database |
| `npm run test:integration:postgres` | All `services/**/*.postgres.test.ts` suites, serially | `TEST_DATABASE_URL` pointing to a disposable database ending in `_test` or `_qa` |
| `npm run test:e2e -w @patchwork/web` | Browser journeys against a locally built web client | Playwright Chromium |
| `npm run test:integration:attachments -w @patchwork/api` | Real private object storage and malware scanner | Disposable PostgreSQL, MinIO, ClamAV; `TEST_ATTACHMENT_*` settings |
| `npm run test:coverage` | Fast tests plus diagnostic V8 coverage, including untested source | Same as unit tests |
| `npm run build` | Workspace production builds | Node |

Install Chromium with `npx playwright install chromium` from `apps/web`, or set
`PATCHWORK_E2E_CHROMIUM_EXECUTABLE` to an installed Chromium binary.

Focused examples:

```sh
npm run test:unit -- packages/shared/src/authorization.test.ts
npm test -w @patchwork/web -- src/discovery-filters.test.ts
npm run test:integration:postgres -w @patchwork/api
npm run test:e2e -w @patchwork/web -- unified-discovery.spec.ts
```

The fast suite excludes database and external-provider tests by filename; it
does not report them as silently skipped successes. PostgreSQL and attachment
commands fail when required configuration is absent. Database suites truncate
tables and must only use disposable data. The automatic integration command
ignores development database URLs and creates its own container.

## Coverage responsibilities

| Boundary | What must remain protected | Primary tests |
| --- | --- | --- |
| Identity and authorization | Session expiry, OAuth failures, role/ownership checks, consent, CSRF, rate limiting, idempotency | API auth, records, HTTP tests; shared authorization contracts |
| Public data and geography | ZIP-only publication, leading zeros, legacy decoding, count conservation, exact public-resource eligibility, private-location absence | AT lexicon/client tests, postal discovery PostgreSQL tests, `check-exact-location-absence.mjs` |
| Private coordination | Durable lifecycle transitions, participant isolation, retries, deletion, private location consent/signaling | API PostgreSQL suites, lifecycle service tests, request/chat/exact-location browser journeys |
| Resource claims and account privacy | Independent approval, pending claims grant no edits, verification, revocation, source retention, export/deactivation | Organization and account-privacy PostgreSQL suites; organization browser journey |
| Ingestion and moderation | Replay/checkpoints, projection correctness, deletion reconciliation, queue persistence, retention | Indexer and moderation PostgreSQL suites plus protocol/unit tests |
| Browser experience | ZIP drill-down and request lists, resource search, location denial/recovery, history, publishing, accessibility, keyboard/mobile navigation | Web E2E suites |
| Release and recovery | Immutable release inputs, rollback state, trusted artifacts, backup replication, map checksums | Executable deployment refusals and shell tests; release workflow gates |

Do not repeat a database persistence rule with an exact mocked SQL-call sequence.
Keep HTTP tests for authentication, validation, and error mapping, and database
tests for persistence, transactions, and concurrency. Browser tests should
exercise a user journey; avoid repeating every schema permutation in the UI.
Use representative responsive boundaries and separate keyboard/focus checks.

Prefer deterministic clocks and fixtures, accessible selectors, and assertions
on observable results. Avoid tests whose only purpose is checking a title
constant, document filename, source substring, internal class name, or exact
implementation call order. Translation-key validation discovers source files
automatically so new routes cannot silently introduce missing keys.

When removing code, remove tests for that code and verify that production
entrypoints, CLI commands, migrations, and public package exports do not depend
on it. Keep migration history, versioned protocol readers, required geography
bundles, and seed provenance.

## CI and external verification

CI runs typechecks, fast tests with coverage once, operational/map/privacy
checks, browser tests, builds, and dependency/container scans. Its database job
runs the same automatically discovered PostgreSQL suites after migrations,
then real attachment-provider integration tests.

Most browser tests mock API transport to isolate web behavior. They do not
prove a live OAuth provider, actual AT publication, mail/push delivery, or a
production deployment. The authenticated staging lifecycle suites require
explicit test credentials and remain separate release qualifications. Their
disposable request ZIP defaults to `10001`; set `PATCHWORK_E2E_POSTAL_CODE`
to use another supported test ZIP. Report
those skips as limitations, not successful live verification.

Generated coverage, screenshots, traces, and run output stay in ignored
`coverage/`, `output/`, `.playwright-cli/`, and Playwright artifact directories.
The artifact privacy check runs before CI uploads. Keep historical run results
with CI/releases rather than adding completion documents or test-count ledgers.


## Product journey additions

- Saved discovery: shared schema tests reject precise origins and eligibility profiles; PostgreSQL tests own deduplication, owner isolation, alert baselines and daily digest behavior. Account-privacy integration covers export and deactivation. The browser journey saves, reloads, reopens and removes an item.
- Resource map: PostgreSQL compares full filtered totals with viewport cell counts independently of the list page. Browser journeys expand aggregates and select a resource outside the loaded page.
- Service details: shared tests cover expired/conflicting evidence, incomplete answers, overnight schedules, closures and DST. Browser checks prove answers never enter requests, URLs or browser storage and clear on reload. Claim integration protects imported evidence and rejects stale provider edits.
- Advanced routing remains an unqualified capability until graph builds, coverage, request cancellation, transient-origin privacy, real itineraries, concurrent performance and the post-activation observation window pass. Do not infer routing completion from service-profile tests.

- Listing corrections: PostgreSQL covers receipt secrecy, retry deduplication, independent review, stale decisions, follow-up, source preservation, assertion quarantine, export/deactivation and retention. The mobile browser journey retries submission, recovers with a receipt after reload and responds to a reviewer without browser storage. These checks do not establish live reviewer or provider qualification.
