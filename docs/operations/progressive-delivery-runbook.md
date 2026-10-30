# Staging Delivery Runbook

## Overview

Patchwork currently uses an atomic, digest-pinned Compose deployment for the
single staging host. Canary traffic shifting is not available until a real
traffic-control layer exists; historical simulated rollout jobs have been removed.

## Current Gitea release lineage

Gitea is the review/CI origin and `main` is the integration and promotion
branch. The former `codex/chicago-public-resources` lineage was merged into
`main` with both histories preserved; keep that branch unchanged and do not
start new work from it. Remaining release reconciliation is tracked in
[issue #21](https://git.subcult.tv/subculture-collective/patchwork/issues/21).
The deployed home-host path accepts scoped-key signed, digest-pinned images.
The GHCR/OIDC procedure below describes a separate configured promotion path;
it must not be represented as the current Gitea deployment evidence. See
[current acceptance](../current-acceptance.md).

## GHCR/OIDC build-once promotion flow

1. `CI` completes quality and PostgreSQL integration gates on `main`.
2. `deploy-staging.yml` builds each of four runtime targets exactly once.
3. Trivy rejects high/critical findings before publication.
4. Images are pushed to the configured staging registry, resolved to registry
   digests, signed with the scoped Cosign key, accompanied by SPDX SBOM and
   Gitea source provenance attestations, and
   recorded in `artifact-digests.json`.
5. The manually dispatched Gitea workflow rechecks the full current `main` SHA
   and its successful CI run. A separate reviewer must accept promotion;
   Gitea does not enforce GitHub environment approvals.
6. The host pulls those exact digests, applies all migration jobs, and starts
   services with `--no-build`.
7. Deep readiness and revision checks establish deployment success. A failed
   deployment invokes rollback only when the retained previous manifest matches
   the release captured at entry. Both credentialed browser suites then qualify
   the deployed application; a browser failure fails the workflow and requires
   investigation rather than automatic migration or test-data rollback.

Before any pull or release-state change, the host runs
`scripts/verify-release-trust.sh`. It constrains the permitted image prefix and
verifies the signature plus both attestations using the scoped staging public
key. The verifier also retains a GitHub OIDC mode for that separate path;
its existence does not qualify Gitea promotion.

### Source-bound Gitea admission

For key-based Gitea promotion, the host also decodes the payload returned by
`cosign verify-attestation`; it never substitutes a separately downloaded,
unverified predicate. Cosign documents this
[verified attestation envelope](https://docs.sigstore.dev/cosign/verifying/attestation/).
The supported Gitea workflow emits SLSA v0.2 provenance. Admission requires:

- The statement subject names the exact image repository and SHA-256 digest
  from that service's manifest entry.
- The invocation source URI and SHA-1, plus a source material entry, name the
  manifest's full commit in the canonical Gitea repository.
- The service parameter matches `api`, `indexer`, `moderation` or `web` as
  appropriate; a signed web artifact cannot occupy the API slot.
- The build type names the repository's staging workflow. Builder identity and
  invocation identity agree on one Gitea Actions run, shared by all four images.

Empty, malformed or mismatched verified provenance is rejected before image
pulls, migration, release-state retention or rollback. Gitea key-based admission
cannot disable the required attestations through
`PATCHWORK_REQUIRE_RELEASE_ATTESTATIONS=false`. This strengthens the declared
source/build binding; signatures and provenance do not independently prove
runtime correctness, provider qualification or a reproducible build.

Older key-based manifests without this provenance contract will be refused by
the new admission script. Preserve their exact retained release/runbook and
review recovery compatibility before any promotion; do not relabel old
attestations or disable the gate to make them pass. The historical keyless/OIDC
path keeps its existing verification contract and is not qualified by these
Gitea checks. No existing release history or live service is changed by updating
the admission implementation.

Canonical `main` remains the promotion source. An attestation built from the
historical Chicago branch does not bypass current-main source admission, even
though that branch is now merged into `main`. Issue #21 remains
open until the actual immutable publication, refusal/recovery and coherent
release/provider record have been qualified. These offline policy checks do
not select an alpha tag or authorize a deployment.

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
                       matching retained previous manifest
```

Release-state changes are implemented and tested in the deployment and rollback shell scripts.

A trust rejection leaves the current release in place. A first deployment
without a retained baseline requires operator recovery if deployment fails.
See [staging configuration](staging-environment.md#deployment-workflow) for
the workflow boundary and [pilot qualification](pilot-qualification.md) for
the remaining release acceptance gates.

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
