# Staging Environment -- Parity & Promotion (#108)

## Overview

The staging environment mirrors production topology 1:1 so that every deployment
is validated against production-equivalent infrastructure before promotion.

## Topology Parity

| Service | Production Container | Staging Container | Port |
|---------|---------------------|-------------------|------|
| API | `patchwork-api` | `patchwork-staging-api` | 4000 |
| Indexer | `patchwork-spool` | `patchwork-staging-spool` | 4100 |
| Moderation | `patchwork-thimble` | `patchwork-staging-thimble` | 4200 |
| Web | `patchwork-web` | `patchwork-staging-web` | 80 |
| Postgres | `patchwork-postgres` | `patchwork-staging-postgres` | 5432 |

Both environments use:
- The same `Dockerfile` multi-stage build targets
- Identical health check configurations
- The same network isolation model (`internal` + `web` networks)
- Production `NODE_ENV=production` with `PATCHWORK_ENV=staging` for metrics labeling
- Three one-shot migration prerequisites and dependency-aware `/health/ready`
  probes; process liveness alone is insufficient

## Configuration Parity

Staging uses the same environment variable keys as production. Values differ only
where necessary (hostnames, DIDs, database passwords):

| Variable | Production | Staging |
|----------|-----------|---------|
| `NODE_ENV` | `production` | `production` |
| `PATCHWORK_ENV` | `production` | `staging` |
| `ATPROTO_SERVICE_DID` | Real DID | Staging DID |
| `API_PUBLIC_ORIGIN` | `https://patchwork.subcult.tv` | `https://staging.patchwork.subcult.tv` |
| `PATCHWORK_POSTGRES_PASSWORD` | Production secret | Staging secret |
| `ATPROTO_OAUTH_CLIENT_ID` | Production metadata URL | Staging metadata URL |
| `ATPROTO_OAUTH_REDIRECT_URI` | Production callback | Staging callback |
| `ATPROTO_SESSION_ENCRYPTION_KEY` | Production encryption key | Staging encryption key |
| `MODERATION_SERVICE_TOKEN` | Production internal token | Staging internal token |

See `docs/operations/staging-secrets.md` for the complete injection and rotation
contract. Neither manifest supplies identity, datasource, origin, OAuth,
encryption, moderation-token, or database-secret fallbacks.

Compose topology is validated by the shared staging-compose tests.

## Deployment pipeline

`ci.yml` runs quality gates and PostgreSQL/provider integration. After successful
CI, `deploy-staging.yml` publishes scanned and signed images, assembles their
digest manifest, and deploys through the protected staging environment.
Migrations, readiness, and authenticated browser checks determine release
success. The delivery and rollback scripts preserve the previous manifest.

A local Compose check validates configuration, not a deployed runtime.

## Smoke Checks

Before promotion from staging to production, the following smoke checks must pass:

1. **Readiness probes** -- `GET /health/ready` returns 200 for API, indexer,
   and moderation worker only after database, schema, stream freshness, and
   internal service dependencies are usable
2. **Migration prerequisites** -- all three one-shot jobs exited successfully
3. **Image label verification** -- OCI labels contain correct git SHA and version

Run smoke checks manually:

```bash
make staging-smoke
```

Failed smoke checks block promotion to production.

## Credentialed lifecycle gate

After a successful digest deployment, `deploy-staging.yml` runs two browser
checks against the deployed public origin:

1. `at-record-lifecycle.spec.ts` creates, projects, discovers, reports, blocks,
   closes, and deletes a disposable AT record with two real OAuth sessions.
2. `staging-release-lifecycle.spec.ts` uses those same isolated accounts to
   verify projection visibility, decline a real offer, create/invite/close a
   group, create/redact a group chat message, and make authenticated durable
   reads for verification and notifications. It reads the maintenance boundary;
   it only declares and resumes maintenance when the protected explicit drill
   variable is enabled.

Both suites use no `page.route` interception. Missing protected fixture values
fail the deploy job rather than producing a skipped green result. Their cleanup
is limited to disposable staging identities and test-labelled group/chat data.
Browser state and artifacts are redacted before the job finishes.

This is staging evidence only. It does not prove that production has the same
revision, that a provider delivered email/push, or that an independent reviewer
approved legal, privacy, accessibility, translation, or security material.

## Promotion gate

The deployment workflow requires successful CI, trusted immutable artifacts,
migrations, deep readiness, and authenticated browser smoke checks. See the
[delivery runbook](progressive-delivery-runbook.md).

## Staging Ownership

The entries below record the accepted interim home-staging assignment effective
2026-08-05. This resolves the unnamed-owner gap but does not provide a distinct
secondary responder, a staffed rotation, or production-hours coverage.

| Responsibility | Owner |
|---------------|-------|
| Environment health | Patrick Fanella |
| Primary on-call | Patrick Fanella |
| Escalation | Patrick Fanella |
| Deployment pipeline | `deploy-staging.yml` workflow |

Patrick Fanella may act as Incident Commander for home-staging incidents and
is the first escalation point for alerts. Contact routing remains
environment-private and must not be committed to this repository. A separate
secondary owner and demonstrated alert acknowledgment are still required
before public operation.

## Make Targets

| Target | Description |
|--------|-------------|
| `make staging-up` | Start staging stack |
| `make staging-down` | Stop staging stack |
| `make staging-ps` | Show staging container status |
| `make staging-logs` | Tail staging logs |
| `make staging-smoke` | Run smoke checks |
| `make staging-db-migrate` | Run database migrations in staging |
| `make staging-build` | Build staging images with immutable tags |

---

Local manifest validation proves topology shape only. Real staging readiness,
backup/restore, rollback, alerts, and incident drills remain Phase 7 exit
evidence.
