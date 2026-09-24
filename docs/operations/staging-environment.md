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

Parity is enforced programmatically by `checkStagingParity()` in
`packages/shared/src/staging.ts`.

## Deployment workflow

`.github/workflows/deploy-staging.yml` is manually dispatched on Gitea `main`
with the full current main SHA. It runs:

1. Preflight: exact-SHA CI status checks, required configuration, signing-key
   agreement, registry login, and read-only SSH prerequisite checks.
2. Four image builds: vulnerability scan, SBOM, Gitea provenance, registry push,
   digest resolution, Cosign key signatures, and attestation verification.
3. Digest-manifest assembly using Gitea-compatible artifact upload/download.
4. Another main/CI check, then SSH transfer into a per-run directory and locked
   digest deployment using the existing staging Compose project identity.
5. Readiness and revision checks, followed by both credentialed browser suites.

A host lock serializes deployment and immediate rollback. The wrapper verifies
release trust before invoking the deploy script. A failed deployment rolls back
only when the retained previous manifest matches the current release captured
at entry. A trust rejection does not roll a healthy service back. A first
deployment without a retained baseline requires operator recovery on failure.
Browser-suite failures fail the workflow and require investigation; they do not
automatically roll back database migrations or their disposable test records.

Configure the repository secrets, variables, host trust root, registry pull
credentials, and existing Compose project name using
[staging-secrets.md](staging-secrets.md). Gitea does not enforce GitHub environment
approvals; this workflow's manual dispatch and branch checks are not a substitute
for a separate reviewer gate.

This describes the port's implementation, not a completed Gitea deployment.
The authorized NUC home-staging exercise published, signed, deployed, rolled
back, and forward-promoted exact digests on 2026-07-28; see
`evidence/phase-7/immutable-delivery.md` for that historical evidence. Qualify the
configured Gitea workflow with a new hosted run before claiming this path works.

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

## Promotion Gate

The `evaluatePromotionGate()` function in `packages/shared/src/staging.ts`
evaluates two conditions:

1. **Parity checks** -- staging topology matches production (service count, env vars)
2. **Smoke checks** -- all service health endpoints respond successfully

Both must pass for `allowed: true`. See the `PromotionGateResult` type for details.

## Staging Ownership

The entries below record the accepted interim home-staging assignment effective
2026-08-05. This resolves the unnamed-owner gap but does not provide a distinct
secondary responder, a staffed rotation, or production-hours coverage.

| Responsibility | Owner |
|---------------|-------|
| Environment health | Patrick Fanella |
| Primary on-call | Patrick Fanella |
| Escalation | Patrick Fanella |
| Deployment pipeline | `.github/workflows/deploy-staging.yml` |

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
