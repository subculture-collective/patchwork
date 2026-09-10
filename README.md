# Patchwork

Prototype for an intended AT Protocol-native mutual aid platform with a web client, query API, ingestion/indexing pipeline, and moderation worker.

This monorepo is designed for fast local development with deterministic fixtures, strong type contracts, and CI quality gates.

## Current maturity

Patchwork is a **pre-alpha, NO-GO system**, not an approved public service. The
narrow alpha now has real AT client adapters, durable private state, live-event
ingestion, PostgreSQL projections, secured HTTP commands, and fail-closed
production data paths. Its complete browser OAuth journey and real staging
signed-digest deployment, rollback, restore, alert, and post-deploy browser
exercises are proven on the NUC home-staging environment. Protected
promotion, independent durability, formal review, production sizing, a
distinct secondary responder, and sustained operational coverage remain
unproven. A five-minute mixed workload established a
bounded 40-RPS aggregate home-staging envelope; it is not a production
capacity claim. The
authoritative subsystem inventory is
[`docs/architecture/current-state-matrix.md`](docs/architecture/current-state-matrix.md),
and continuation work is sequenced by the
[`2026-07-10 continuation roadmap`](docs/superpowers/plans/2026-07-10-patchwork-continuation-roadmap.md).
The current launch decision is the operational **NO-GO** recorded in the
[`2026-08-05 coordination, localization, groups, and chat evidence`](docs/operations/evidence/coordination-localization-groups-chat-2026-08-05.md).
The earlier
[`2026-07-28 alpha go/no-go review`](docs/operations/evidence/phase-8/alpha-go-no-go.md)
is retained as historical evidence.

The approved feature-completion target is the
[`buyer-ready web product charter`](docs/product/buyer-ready-web-charter.md),
with its
[`historical baseline gap assessment`](docs/product/buyer-ready-gap-assessment.md) and
[`ordered completion roadmap`](docs/superpowers/plans/2026-07-28-buyer-ready-web-completion-roadmap.md).
That product-development decision does not by itself authorize Patchwork to
operate as a public mutual-aid service.

## What’s in this repo

- `apps/web` — Vite + React + TypeScript + Tailwind frontend
- `services/api` — HTTP API for query/chat/volunteer flows
- `services/indexer` — ingestion + indexing service
- `services/moderation-worker` — moderation/trust-safety worker
- `packages/shared` — shared contracts, config/env schemas, utilities
- `packages/at-lexicons` — AT lexicon schemas, fixtures, and validators
- `packages/at-client` — official AT OAuth and repository client adapters used by non-test API startup

## Patchwork component naming

- **Patchwork Web** — client (`patchwork-web`)
- **Patchwork API** — query + auth (`patchwork-api`)
- **Spool** — ingestion + queueing (`patchwork-spool`)
- **Quilt** — indexing + search layer (network alias on `patchwork-spool`: `patchwork-quilt`)
- **Stitch** — chat service (network alias on `patchwork-api`: `patchwork-stitch`)
- **Thimble** — moderation worker (`patchwork-thimble`)

## Tech stack

- Node.js + TypeScript (monorepo workspaces)
- React + Vite + Tailwind (web)
- Vitest + Playwright (unit + browser E2E)
- PostgreSQL for the API and encrypted AT OAuth session state

## Prerequisites

- Node.js `>=20.19.0`
- npm
- Docker or another PostgreSQL 16 instance

## Quick start

1. Install dependencies: `npm ci`
2. Create local env file: copy `.env.example` → `.env`
3. Generate `ATPROTO_SESSION_ENCRYPTION_KEY` with `openssl rand -base64 32`,
   set the OAuth client ID and callback URL documented in `.env.example`, and
   run `npm run db:up`, then all three migration commands listed below.
4. Start the app surfaces you need:
    - Web: `npm run dev:web`
    - API: `npm run dev:api`
    - Indexer: `npm run dev:indexer`
    - Moderation worker: `npm run dev:moderation`

Default local URLs:

- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`
- Indexer health: `http://localhost:4100/health`
- Moderation health: `http://localhost:4200/health`

## API datasource modes

The API retains two datasource modes, but fixture mode is test-only:

- `fixture`: deterministic in-memory data used only under `NODE_ENV=test`
- `postgres`: required for development and production API startup

### Postgres mode

1. Start Postgres: `npm run db:up`
2. Set in `.env`:
    - `API_DATA_SOURCE=postgres`
    - `API_DATABASE_URL=postgresql://patchwork:patchwork@localhost:5432/patchwork`
    - `API_MODERATION_SERVICE_URL=http://localhost:4200`
    - matching `MODERATION_SERVICE_TOKEN` values for API and moderation worker
3. Run migrations:
    - `npm run db:migrate -w @patchwork/api`
    - `DATABASE_URL=... npm run db:migrate -w @patchwork/indexer`
    - `DATABASE_URL=... npm run db:migrate -w @patchwork/moderation-worker`
4. Optionally seed deterministic discovery data: `npm run db:seed`
5. Start API in postgres mode: `npm run dev:api`

### PostgreSQL-backed frontend mode (Map / Feed / Resources / Posting)

The web client now calls API routes directly for discovery + posting surfaces:

- `GET /query/map`
- `GET /query/feed`
- `GET /query/directory`
- `POST /at/aid-posts`
- `POST /at/directory-resources`

Authenticated AT repository commands are exposed separately:

- `POST /at/aid-posts`
- `GET /at/aid-posts?uri=...`
- `PUT /at/aid-posts`
- `POST /at/aid-posts/close`
- `DELETE /at/aid-posts`
- `POST /at/directory-resources`
- `GET /at/directory-resources?uri=...`
- `PUT /at/directory-resources`
- `DELETE /at/directory-resources`

The production API exposes no fixture-backed compatibility commands. Durable,
authenticated routes now cover settings, organizations, verification, inbox,
feedback, attachments, scheduling, groups, and bounded server-readable chat.
Reputation remains an unwired experiment and is not a production route. The
authoritative route inventory is
[`docs/architecture/buyer-ready-api-contracts.md`](docs/architecture/buyer-ready-api-contracts.md).

Recommended local flow:

1. Start Postgres: `npm run db:up`
2. Seed Postgres: `npm run db:seed`
3. Start API in postgres mode: `npm run dev:api:postgres`
4. Start web: `npm run dev:web`

In the UI, route headers show a data source badge:

- **DB-backed API** when remote query succeeds
- **Fallback dataset** is test/demo behavior only and is not a production data
  source

Posting behavior in DB mode:

- `Publish request` sends a bounded JSON record to authenticated
  `POST /at/aid-posts`
- Public coordinates are rounded and carry at least 1 km precision before the
  PDS write; exact draft coordinates are not sent
- Live discovery follows the Phase 5 ingestion/projection path and must not
  claim immediate visibility until that runtime is connected
- Signed-in directory stewards publish records as `unverified`, edit/delete
  owned records with CID compare-and-swap, and receive explicit
  eventual-consistency notices while Jetstream updates the projection

Additional seed scripts (API workspace):

- Append mode: `npm run db:seed:append -w @patchwork/api`
- Phase 3 fixtures only: `npm run db:seed:phase3 -w @patchwork/api`

Stop Postgres when done: `npm run db:down`

## Common commands

- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Core alpha tests: `npm run test`
- PostgreSQL + HTTP integration: `npm run test:integration:postgres -w @patchwork/api`
- Direct service integration: `npm run test:integration:service -w @patchwork/web`
- Browser E2E (web): `npm run test:e2e -w @patchwork/web`
- Diagnostic coverage: `npm run test:coverage`
- Build all workspaces: `npm run build`
- Combined local gate: `npm run check`

## Docker deployment (shared `web` network)

The production compose stack is defined in `docker-compose.yml`.

- Caddy route host: `https://patchwork.subcult.tv`
- Shared Docker network: `web` (external)
- Internal service network: `internal`

Services:

- `patchwork-web` (nginx serving built Vite app)
- `patchwork-api`
- `patchwork-spool` (also aliased as `patchwork-quilt`)
- `patchwork-thimble`
- `patchwork-postgres`

Monitoring:

- API, Spool, and Thimble expose `/metrics`, and validated rules live under
  `monitoring/prometheus/`. The repository does not bundle or deploy a
  Prometheus server or notification receiver.

## Architecture and protocol docs

- `docs/superpowers/plans/2026-07-10-patchwork-continuation-roadmap.md` — authoritative continuation roadmap from pre-alpha prototype to a durable AT Protocol alpha
- `docs/product/buyer-ready-web-charter.md` — approved responsive-web feature-completion target
- `docs/product/buyer-ready-gap-assessment.md` — current runtime compared with the buyer-ready target
- `docs/superpowers/plans/2026-07-28-buyer-ready-web-completion-roadmap.md` — ordered post-alpha feature-completion plan
- `docs/architecture/domain-map.md`
- `docs/architecture/service-boundaries.md`
- `docs/architecture/adr/0001-v1-stack-and-domain-boundaries.md`
- `docs/at-protocol/README.md`
- `docs/at-protocol/identity-session.md`
- `docs/at-protocol/lexicon-versioning.md`
- `docs/at-protocol/tombstone-contract.md`
- `docs/quality-gates.md`

## Notes for contributors

- Keep cross-service contracts in `packages/shared`.
- Prefer deterministic fixtures in tests.
- Treat geoprivacy/moderation regressions as release blockers.

## License

Licensed under `GPL-3.0-or-later`. See [LICENSE](LICENSE).
