# Patchwork

Patchwork is an AT Protocol mutual aid application: a React web client, an HTTP
API, an ingestion/indexing service, and a moderation worker. It is under active
development.

Requests publish a five-digit US ZIP as their finest public location. Nearby
browsing groups requests by state, county, and ZIP. Eligible public resources
have separate pins at their published street addresses and can be claimed
through an independently reviewed organization claim.

## Repository

- `apps/web` — React, Vite, and Tailwind frontend
- `apps/mobile` — mobile client foundation
- `services/api` — authentication, publishing, discovery, and private coordination
- `services/indexer` — Spool: AT event ingestion and PostgreSQL projections
- `services/moderation-worker` — Thimble: moderation and retention
- `packages/shared` — contracts, configuration, and shared domain behavior
- `packages/at-lexicons` — versioned AT schemas and postal lookup
- `packages/at-client` — AT OAuth and repository adapters

## Local development

Requires Node.js **22.15 or newer**, npm, and Docker or PostgreSQL 16.

1. Run `npm ci` and copy `.env.example` to `.env`.
2. Configure the database and AT OAuth settings documented in `.env.example`.
   Generate the session encryption key with `openssl rand -base64 32`.
3. Run `npm run db:up`, then migrate all three services:
   ```sh
   npm run db:migrate -w @patchwork/api
   npm run db:migrate -w @patchwork/indexer
   npm run db:migrate -w @patchwork/moderation-worker
   ```
   Set `API_DATABASE_URL` for the API and `DATABASE_URL` for the other services.
4. Preview real Chicago metro resources with `npm run db:seed:resources`; add `-- --apply` to import them. This creates no demo requests or accounts.
5. Start the needed services in separate terminals:
   ```sh
   npm run dev:api
   npm run dev:indexer
   npm run dev:moderation
   npm run dev:web
   ```

The web client runs at `http://localhost:5173`; API, indexer, and moderation
health endpoints use ports 4000, 4100, and 4200. Development and production API
startup require PostgreSQL. Fixture mode is reserved for tests.

## Validation

```sh
npm run check              # Typecheck, fast tests, map/privacy and operational checks
npm run test:integration   # Disposable PostgreSQL, migrations, all DB suites
npm run test:e2e -w @patchwork/web
npm run test:coverage      # Fast-suite diagnostic coverage
npm run build
```

See [Testing and quality gates](docs/quality-gates.md) for focused commands,
required external-service checks, and guidance on adding durable tests.

## Architecture and operations

- [Service boundaries](docs/architecture/service-boundaries.md)
- [API contracts](docs/architecture/buyer-ready-api-contracts.md)
- [Postal geography, public sources, and claims](docs/architecture/postal-geography.md)
- [AT Protocol contracts](docs/at-protocol/README.md)
- [Staging environment](docs/operations/staging-environment.md)
- [Deployment and rollback](docs/operations/progressive-delivery-runbook.md)
- [Backup and recovery](docs/operations/disaster-recovery.md)
- [Incident response](docs/operations/incident-response.md)
- [Privacy policy](docs/legal/privacy-policy.md)

`docker-compose.yml` defines the production services. `docker-compose.staging.yml`
and `.github/workflows/deploy-staging.yml` define staging deployment. Monitoring
rules are under `monitoring/prometheus`; monitoring servers and notification
receivers are operated separately.

Keep enduring contracts and runbooks in this repository. Put transient test
output in ignored artifact directories and attach release evidence to the
relevant CI run or release. Historical plans and completion reports remain
available in Git history.

## License

[GPL-3.0-or-later](LICENSE).
