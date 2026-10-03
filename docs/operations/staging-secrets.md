# Staging secret injection

Patchwork staging fails closed when required identity, OAuth, database, or
service-auth values are absent. Compose files contain variable references only;
do not commit resolved Compose output or an environment file.

## Gitea workflow configuration

`.github/workflows/deploy-staging.yml` targets
`git.subcult.tv/subculture-collective/patchwork`. Gitea loads the existing
`.github/workflows` directory; do not introduce a second workflow directory
that shadows CI. Dispatch it from `main`, supplying the full current main SHA
as `source_sha`. The workflow requires the dispatch revision to match that SHA
and checks the latest `CI / quality-gates (push)` and
`CI / e2e-production (push)` statuses from the same Gitea run. It checks main
again before deployment; if main advances while images build, dispatch the new
accepted commit instead of promoting the old one.

Configure the following under the repository's **Settings → Actions → Secrets**
and **Variables**. Do not paste values into issues or chat. The workflow supplies `secrets.RELEASE_TOKEN` through the `GITEA_TOKEN`
environment variable to read repository metadata and CI status. The organization
provides this secret; a repository override takes precedence. A separate package
token authenticates the registry. Do not create a custom secret named
`GITEA_TOKEN`: Gitea reserves that prefix.

| Secret | Purpose |
| --- | --- |
| `RELEASE_TOKEN` | Gitea PAT permitted to read this repository and its Actions runs; inherited from the organization unless overridden |
| `STAGING_REGISTRY_TOKEN` | Dedicated Gitea PAT with `write:package`, owned by an account allowed to publish packages under `subculture-collective` |
| `STAGING_COSIGN_PRIVATE_KEY` | Encrypted PEM signing key; supplied to Cosign through its environment, never copied to staging |
| `STAGING_COSIGN_PASSWORD` | Nonempty password for the signing key |
| `STAGING_SSH_PRIVATE_KEY` | Dedicated unencrypted automation SSH key for the staging deploy account |
| `STAGING_SSH_KNOWN_HOSTS` | Host keys verified independently for the exact staging SSH hostname |
| `STAGING_SSH_USER`, `STAGING_SSH_HOST` | Staging SSH account and hostname or IPv4 address, using port 22 |

All browser fixture secrets in the table below are also required before any
image build, including the maintainer storage state. The workflow reports
missing names without printing their values.

| Variable | Purpose |
| --- | --- |
| `STAGING_REGISTRY_USERNAME` | Gitea account that owns the package PAT |
| `STAGING_COSIGN_PUBLIC_KEY` | Matching PEM public key; preflight compares it with the private key and the host's independent trust root |
| `STAGING_COSIGN_PUBLIC_KEY_PATH` | Absolute path to the public key already installed on staging |
| `STAGING_DEPLOY_PATH` | Existing writable absolute directory; each run transfers into `run-<id>` below it |
| `STAGING_COMPOSE_PROJECT_NAME` | Existing staging Compose project name; inspect `com.docker.compose.project` on the staging containers before setting it, to preserve the stack's volumes and networks |
| `STAGING_SSH_USE_SUDO` | Optional `true` to run host preflight and deployment through existing noninteractive sudo; defaults to `false` |
| `STAGING_COMPOSE_OVERRIDE_FILE` | Optional absolute path to the existing host Compose override; passed to deployment and rollback |
| `STAGING_ENV_FILE` | Absolute path to the existing staging runtime environment file, outside the checkout |
| `STAGING_PUBLIC_ORIGIN` | HTTPS origin for browser checks, without a trailing slash |
| `STAGING_VITE_API_BASE_URL` | HTTPS API URL or same-origin absolute path such as `/api` |
| `STAGING_VITE_MAP_TILE_URL` | Content-addressed `/tiles/us.<sha256>.pmtiles` path |
| `STAGING_E2E_EXERCISE_MAINTENANCE` | Optional `true` or `false`; defaults to `false` |

Use simple absolute filesystem paths without spaces or shell metacharacters.
The workflow deliberately rejects values that would be unsafe to embed in a
remote SSH command.

### Host prerequisites and signing

Provision the staging account and runtime configuration before dispatch. The
account needs Docker access, Docker Compose v2, Bash, `jq`, `flock`, `sha256sum`,
and Cosign compatible with the workflow's pinned v2.5.2. It must be able to read
the runtime environment and public key and write the deployment directory and
`/var/lib/patchwork/releases`. With `STAGING_SSH_USE_SUDO=true`, those reads and
release-state writes use the account's existing noninteractive sudo access; the
transfer directory must still be writable by the SSH account. Do not loosen
root-owned runtime-file permissions to satisfy preflight. Preserve the existing release manifests and
checksums. Authenticate Docker and Cosign on the host to `git.subcult.tv` with
a separate `read:package` credential for private image pulls; the publishing
PAT is not transferred by the workflow. Retain access to the previous release's
registry until rollback is qualified. Provision the external `staging-web`
network and versioned map tile file described by the Compose file. Retain any
host override that pins external database volumes or ingress bindings using
`STAGING_COMPOSE_OVERRIDE_FILE`.

Generate the encrypted signing key using `cosign generate-key-pair` in the
approved secret-management environment. Store the private key and password in
Gitea Actions secrets. Install the public key independently on staging and put
that same public key in `STAGING_COSIGN_PUBLIC_KEY`. Protect the host trust root
from writes by the deployment account; the workflow never replaces it.

Images are pushed under `git.subcult.tv/subculture-collective/patchwork-*`,
resolved to digests, signed, and attested with SPDX and SLSA predicates. Key-based
signing replaces GitHub OIDC. TLS, signature, attestation, and transparency-log
verification remain enabled. Cosign's default public Rekor transparency log
records signing evidence, including image identity and the public key. This
pipeline does not introduce a private transparency log.

Gitea ignores GitHub's `environment: staging` gate. This workflow therefore uses
repository-scoped values and a manual dispatch restricted to this Gitea
repository's `main` revision. That is **not** a protected-environment approval
mechanism: repository writers and runner administrators are trusted with these
credentials. Restrict write/dispatch access and protect main before configuring
secrets. If separate reviewer approval is required, keep deployment disabled
until that control exists outside this workflow. See the
[Gitea compatibility reference](https://docs.gitea.com/usage/actions/comparison/)
and [Cosign self-managed keys](https://docs.sigstore.dev/cosign/key_management/signing_with_self-managed_keys/).

The port and local tests alone do not qualify registry publication, hosted
artifact transfer, SSH deployment, or browser lifecycle checks. Record the
first configured end-to-end run and its exact deployed digests separately.

## Required runtime values

| Variable | Requirement | Consumer |
| --- | --- | --- |
| `PATCHWORK_STAGING_POSTGRES_PASSWORD` | Random database password, URL-safe | PostgreSQL and all migration/runtime services |
| `STAGING_ATPROTO_SERVICE_DID` | Real staging service DID; never `did:example` | API, indexer, moderation, migrations |
| `ATPROTO_PDS_URL` | Controlled PDS HTTPS origin | AT runtimes |
| `STAGING_ATPROTO_OAUTH_CLIENT_ID` | Public HTTPS OAuth client metadata URL | API |
| `STAGING_ATPROTO_OAUTH_REDIRECT_URI` | Registered HTTPS callback URL | API |
| `STAGING_ATPROTO_SESSION_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes | API session encryption |
| `STAGING_PUBLIC_ORIGIN` | Canonical staging web HTTPS origin | API origin/CSRF policy |
| `STAGING_VITE_API_BASE_URL` | Browser-visible staging API HTTPS origin | Web build |
| `STAGING_VITE_MAP_TILE_URL` | Same-origin content-addressed URL matching `/tiles/us.<sha256>.pmtiles` | Web build |
| `STAGING_MODERATION_SERVICE_TOKEN` | Random internal bearer secret | API and moderation worker |
| `INDEXER_FIREHOSE_URL` | Approved Jetstream/WebSocket source | Indexer |
| `JETSTREAM_API_KEY` | Bluesky Preferred Providers API key; required for metered v2 replay HTTP requests and never sent to the v1 source | v2 shadow indexer |

## Protected browser-lifecycle inputs

The deploy workflow has two non-mocked browser suites.  They run only in the
Gitea deployment job after the digest deployment has passed readiness.
These values are **test credentials and disposable fixtures**, not application
configuration. Store them as access-controlled repository secrets/variables; never commit a
Playwright storage-state file.

| Value | Protection | Purpose |
| --- | --- | --- |
| `STAGING_E2E_REQUESTER_STATE_B64` | Secret | OAuth storage state for the disposable request owner |
| `STAGING_E2E_HELPER_STATE_B64` | Secret | OAuth storage state for the second disposable account |
| `STAGING_E2E_MAINTAINER_STATE_B64` | Secret | Fresh OAuth state (less than five minutes old when a drill is enabled) for a dedicated staging-only maintenance operator |
| `STAGING_E2E_EXACT_LATITUDE`, `STAGING_E2E_EXACT_LONGITUDE` | Secret | Disposable approximate discovery point; never a real address |
| `STAGING_E2E_PRIVATE_MARKER` | Secret | Unique private string used by redaction assertions |
| `STAGING_ARTIFACT_REDACTION_TERMS` | Secret | Terms the browser-artifact scrubber must reject |
| `STAGING_E2E_EXERCISE_MAINTENANCE` | Protected variable, default `false` | Enables the declare/resume transition only during an announced isolated drill |

The lifecycle suite creates a group, invitation, group-room conversation, one
message, and a declined offer under the disposable accounts. It redacts the
message and closes the group in `finally`; the retained audit trail is expected
durable test evidence. It does not submit verification evidence, make a real
verification decision, send email, or register browser push: those require
separately authorized provider and reviewer exercises. The maintenance
transition remains disabled unless the protected opt-in is exactly `true`; do
not enable it while other staging users are active.

Generate the session key with `openssl rand -base64 32`. Generate database and
service tokens with an approved password manager or secret platform. Never put
these values in shell history, issue text, screenshots, logs, Playwright state,
or repository files.

## Injection contract

Inject values through the deployment platform's protected environment or a
root-owned runtime environment file outside the checkout. Render and validate
without printing resolved values:

```bash
docker compose -f docker-compose.staging.yml config --quiet
```

Do not use `docker compose config` without `--quiet` in CI logs because it
expands secrets. Rotate the OAuth/session key by invalidating existing browser
sessions and redeploying the API. Rotate the moderation token by updating API
and worker atomically. Database credential rotation requires updating all three
migration jobs and all three database-backed runtimes in one maintenance step.

## Startup order

Compose enforces this dependency chain:

1. PostgreSQL becomes healthy.
2. API, indexer, and moderation one-shot migrations complete successfully.
3. Indexer and moderation readiness checks validate their dependencies.
4. API starts only after its schema, the projection schema, fresh indexer, and
   moderation worker are ready.
5. Web starts only after API deep readiness succeeds.

Any missing secret, failed migration, unavailable dependency, or stale stream
keeps the dependent service unready rather than producing simulated success.
