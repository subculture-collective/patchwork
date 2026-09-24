# Staging Delivery Runbook

## Overview

Patchwork currently uses an atomic, digest-pinned Compose deployment for the
single staging host. Canary traffic shifting is not available until a real
traffic-control layer exists; historical simulated rollout jobs have been removed.

## Build-once promotion flow

1. `CI` completes quality and PostgreSQL integration gates on `main`.
2. `deploy-staging.yml` builds each of four runtime targets exactly once.
3. Trivy rejects high/critical findings before publication.
4. Images are pushed to GHCR, resolved to registry digests, keyless-signed with
   Cosign, accompanied by SPDX SBOM and SLSA provenance attestations, and
   recorded in `artifact-digests.json`.
5. The protected `staging` environment authorizes deployment.
6. The host pulls those exact digests, applies all migration jobs, and starts
   services with `--no-build`.
7. Deep readiness and the real two-account OAuth/PDS browser test determine
   success. A failure invokes the previous digest manifest automatically.

Before any pull or release-state change, the host runs
`scripts/verify-release-trust.sh`. It constrains the permitted image prefix and
verifies the signature plus both attestations using either the protected
GitHub OIDC identity or the scoped home-staging public key.

The loopback-only home-staging registry additionally sets
`PATCHWORK_COSIGN_ALLOW_INSECURE_REGISTRY=true` and, because its scoped local
key has no transparency-log record,
`PATCHWORK_COSIGN_INSECURE_IGNORE_TLOG=true`. Both defaults are false and must
not be enabled for the protected GHCR/OIDC path.

## Deployment state sequence

```
CI accepted -> images scanned -> images signed -> environment approved
     -> migrations -> deep readiness -> browser smoke -> current manifest
                              |                  |
                              +---- failure -----+
                                      |
                              previous manifest
```

Release-state changes are implemented and tested in the deployment and rollback shell scripts.

## Deployment Observability Checkpoints

The deployment is accepted only when these executable checkpoints succeed:

| Checkpoint | What It Checks |
|-----------|----------------|
| migration jobs | API, indexer, and moderation jobs exit zero |
| service readiness | Each database-backed runtime returns 200 from `/health/ready` |
| browser smoke | Real OAuth/PDS create, discover, report, block, close, delete passes |
| artifact redaction | Failure traces contain none of the supplied sensitive values |

Metrics-based canary promotion remains Task 7.3/production follow-up and must
not be represented as passing until real telemetry is queried.

## Manual rollback

```bash
cd "$STAGING_DEPLOY_PATH"
./rollback-staging-digests.sh "$STAGING_ENV_FILE" docker-compose.staging.yml
```

This restores all four runtime images together. It deliberately does not run
down migrations; see the forward-compatibility constraints in the rollback
policy.

## Telemetry

Use the deployed readiness endpoints, CI job output, release manifest, and
Prometheus metrics to evaluate the release. Alert rules are in
`monitoring/prometheus/patchwork-alerts.yml`; they do not implement automatic
canary traffic control.

## Escalation

If a staging deployment causes an incident:

1. **Restore the previous manifest immediately:** run
   `rollback-staging-digests.sh` as shown above.
2. Follow the [Incident Response Runbook](incident-response.md)
3. Open a post-incident review after the rollback is confirmed stable
4. Update the rollback record with the trigger reason and resolution

---

Do not enable percentage-based promotion until the traffic router and live SLO
queries exist and have failure-drill evidence.
