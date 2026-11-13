# Staging secret injection

Patchwork staging fails closed when required identity, OAuth, database, or
service-auth values are absent. Compose files contain variable references only;
do not commit resolved Compose output or an environment file.

## Gitea workflow configuration

`.gitea/workflows/deploy-staging.yml` targets
`git.subcult.tv/subculture-collective/patchwork`. Gitea loads only
`.gitea/workflows`, which holds main CI and deployment. `.github/workflows`
holds only `mirror-ci.yml`, which runs pull request branches on the public
GitHub mirror and reports `GitHub CI / Mirror CI gate` back to Gitea; it has no
secrets and cannot deploy. After both push CI gates pass, `CI / deploy-staging` uses the
job token with `actions: write` to dispatch the current main SHA as `source_sha`.
The dispatcher rechecks main and both successful push statuses before its
request. Manual dispatch from `main` remains available for retries.
The workflow requires the dispatch revision to match that SHA
and checks the latest `CI / quality-gates (push)` and
`CI / e2e-production (push)` statuses from the same Gitea run. It checks main
again before deployment; if main advances while images build, dispatch the new
accepted commit instead of promoting the old one.

Configure the following under the repository's **Settings → Actions → Secrets**
and **Variables**. Do not paste values into issues or chat. The built-in
`GITEA_TOKEN` reads repository metadata; a separate package token authenticates
the registry. Repository/owner token settings must permit `contents: read` and
`actions: write` for dispatch; deployment jobs request only `actions: read`.

| Secret | Purpose |
| --- | --- |
| `STAGING_REGISTRY_TOKEN` | Dedicated Gitea PAT with `write:package`, owned by an account allowed to publish packages under `subculture-collective` |
| `STAGING_COSIGN_PRIVATE_KEY` | Encrypted PEM signing key; supplied to Cosign through its environment, never copied to staging |
| `STAGING_COSIGN_PASSWORD` | Nonempty password for the signing key |
| `STAGING_SSH_PRIVATE_KEY` | Dedicated unencrypted automation SSH key for the staging deploy account |
| `STAGING_SSH_KNOWN_HOSTS` | Host keys verified independently for the exact staging SSH hostname |
| `STAGING_SSH_USER`, `STAGING_SSH_HOST` | Staging SSH account and hostname or IPv4 address, using port 22 |

All browser fixture inputs below are also required before any image build.
Preflight obtains fresh requester, helper, and maintainer OAuth sessions from
the dedicated staging accounts. It reports missing names without printing
their values.

| Variable | Purpose |
| --- | --- |
| `STAGING_REGISTRY_USERNAME` | Gitea account that owns the package PAT |
| `STAGING_COSIGN_PUBLIC_KEY` | Matching PEM public key; preflight compares it with the private key and the host's independent trust root |
| `STAGING_COSIGN_PUBLIC_KEY_PATH` | Absolute path to the public key already installed on staging |
| `STAGING_DEPLOY_PATH` | Existing writable absolute directory; each run transfers into `run-<id>` below it |
| `STAGING_COMPOSE_PROJECT_NAME` | Existing staging Compose project name; inspect `com.docker.compose.project` on the staging containers before setting it, to preserve the stack's volumes and networks |
| `STAGING_SSH_USE_SUDO` | Still validated by `scripts/check-staging-workflow-config.sh`; the host's forced command now decides elevation, so it no longer changes deployment |
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
account needs Docker access, Docker Compose v2, Bash, Python 3, `jq`, `flock`, `sha256sum`,
and Cosign compatible with the workflow's pinned v2.5.2. It must be able to read
the runtime environment and public key and write the deployment directory and
`/var/lib/patchwork/releases`. On the host the deploy key is restricted to the
forced command `/usr/local/lib/patchwork-staging/patchwork-staging-ssh`, which
accepts five verbs: `preflight`, `cosign-pub`, `e2e-accounts`,
`reset-test-blocks <run>` and `deploy <run-id> <main sha>`. The runner sends
only `artifact-digests.json`. The host takes the release scripts and Compose file
from its own clone of `main` at that commit and runs them as root, so the host
paths are fixed in the wrapper rather than read from these variables. Do not loosen
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
repository-scoped values and a dispatch restricted to this Gitea
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

The deploy workflow has two non-mocked browser suites. They run in the Gitea
deployment job after the digest deployment has passed readiness. These values
are **test credentials and disposable fixtures**, not application configuration.
Never commit a Playwright storage-state file.

| Value | Protection | Purpose |
| --- | --- | --- |
| `STAGING_E2E_REQUESTER_STATE_B64` | Generated masked job environment | Fresh OAuth storage state for the disposable request owner |
| `STAGING_E2E_HELPER_STATE_B64` | Generated masked job environment | Fresh OAuth storage state for the second disposable account |
| `STAGING_E2E_MAINTAINER_STATE_B64` | Generated masked job environment | Fresh OAuth state for a dedicated staging-only maintenance operator |
| `STAGING_E2E_EXACT_LATITUDE`, `STAGING_E2E_EXACT_LONGITUDE` | Secret | Disposable approximate discovery point; never a real address |
| `STAGING_E2E_PRIVATE_MARKER` | Secret | Unique private string used by redaction assertions |
| `STAGING_ARTIFACT_REDACTION_TERMS` | Secret | Terms the browser-artifact scrubber must reject |
| `STAGING_E2E_EXERCISE_MAINTENANCE` | Protected variable, default `false` | Enables the declare/resume transition only during an announced isolated drill |

Keep the disposable coordinates within 100 km of the lifecycle suite's New
York feed origin (40.7128, -74.006), consistent with its default request ZIP
`10001`. The suite rejects an out-of-area point before publishing a record.

`scripts/bootstrap-staging-sessions.sh` reads the existing root-owned
`/etc/patchwork/e2e-accounts/accounts.json` through the deploy key's
`e2e-accounts` verb. The file must be mode
`0600`, owned by root, and contain `requester`, `helper`, and `maintainer`
objects with a handle, password, DID, purpose, and `review_by` date. All three
must be distinct approved accounts with purpose exactly `Patchwork deployment
browser tests` and a review date that has not passed. Rotate their credentials
and review their ownership before that date; an expired review blocks release.
Passwords stay in the host store and private runner scratch space, which is
removed on exit. They are never added to repository secrets or artifacts.

The bootstrap uses the controlled `pds.subcult.tv` provider, completes Patchwork
OAuth, verifies each DID, and accepts the repository's current policy only for
these disposable test accounts. Provision the maintainer's `admin` role using
the [operator procedure](platform-role-provisioning.md) and retain its audit
record; the bootstrap checks that role without changing it. It exports only
the secure Patchwork session and CSRF cookies, excluding provider cookies and
local storage. Preflight verifies the accounts before image builds; deployment
refreshes them again immediately before the browser suites. Static session
secrets are no longer consumed because application sessions expire after
twelve hours. TLS validation remains enabled throughout.

The AT-record browser suite resets its disposable helper/requester block before
and after the test. `scripts/reset-staging-test-blocks.sh` asks the deploy key's
`reset-test-blocks` verb to run the Python helper on NUC from the deployed
commit. The helper requires the root-owned
account store, current fixture approvals, and the expected staging database
container. It marks only that pair's known test block deleted and retains its
previous row under `/var/lib/patchwork/releases/e2e-block-cleanup/` in a
root-owned, mode-0700 directory. The recovery record is written before the
change; block rows remain in the database. This keeps repeated discovery and
coordination checks independent of the preceding block assertion.

The artifact checker combines the required configured redaction terms with
active fixture coordinates, the private marker, and cookie values from the
three protected storage-state files. A match blocks publication without
printing the matched value. Missing configured terms or unreadable protected
state also block the artifact check.

The lifecycle suite creates a disposable volunteer profile, group, invitation,
group-room conversation, one message, and a declined offer under the dedicated
accounts. It waits for the active volunteer profile's projection before offering
help. It deletes that profile, redacts the message, and closes the group in
`finally`; the retained audit trail is expected
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
