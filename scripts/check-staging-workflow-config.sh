#!/usr/bin/env bash
# Validate configuration without printing credentials or contacting staging.
set -Eeuo pipefail

missing=0
for name in \
    STAGING_REGISTRY_USERNAME STAGING_REGISTRY_TOKEN \
    STAGING_COSIGN_PRIVATE_KEY STAGING_COSIGN_PASSWORD STAGING_COSIGN_PUBLIC_KEY \
    STAGING_SSH_PRIVATE_KEY STAGING_SSH_KNOWN_HOSTS STAGING_SSH_USER STAGING_SSH_HOST \
    STAGING_DEPLOY_PATH STAGING_ENV_FILE STAGING_COSIGN_PUBLIC_KEY_PATH STAGING_COMPOSE_PROJECT_NAME \
    STAGING_PUBLIC_ORIGIN STAGING_VITE_API_BASE_URL STAGING_VITE_MAP_TILE_URL \
    STAGING_E2E_REQUESTER_STATE_B64 STAGING_E2E_HELPER_STATE_B64 \
    STAGING_E2E_MAINTAINER_STATE_B64 STAGING_E2E_EXACT_LATITUDE \
    STAGING_E2E_EXACT_LONGITUDE STAGING_E2E_PRIVATE_MARKER STAGING_ARTIFACT_REDACTION_TERMS; do
    if [[ -z "${!name:-}" ]]; then
        echo "Missing staging workflow input: $name" >&2
        missing=1
    fi
done
[[ $missing == 0 ]] || exit 1
[[ "$STAGING_SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$STAGING_SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
# These values cross an SSH shell boundary. Deliberately accept simple absolute
# paths only; this also keeps quotes and shell substitution out of remote commands.
for name in STAGING_DEPLOY_PATH STAGING_ENV_FILE STAGING_COSIGN_PUBLIC_KEY_PATH; do
    [[ "${!name}" =~ ^/[a-zA-Z0-9_./-]+$ && "${!name}" != *'/../'* && "${!name}" != */.. ]]
done
[[ "$STAGING_DEPLOY_PATH" != / ]]
[[ "$STAGING_COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
[[ "$STAGING_PUBLIC_ORIGIN" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]
[[ "$STAGING_VITE_API_BASE_URL" =~ ^(https://[a-zA-Z0-9.-]+(:[0-9]+)?)?/[a-zA-Z0-9_./-]*$ ||
   "$STAGING_VITE_API_BASE_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]
[[ "$STAGING_VITE_API_BASE_URL" != //* ]]
[[ "$STAGING_VITE_MAP_TILE_URL" =~ ^/tiles/us\.[0-9a-f]{64}\.pmtiles$ ]]
[[ "${STAGING_E2E_EXERCISE_MAINTENANCE:-false}" =~ ^(true|false)$ ]]

[[ "${STAGING_SSH_USE_SUDO:-false}" =~ ^(true|false)$ ]]
if [[ -n "${STAGING_COMPOSE_OVERRIDE_FILE:-}" ]]; then
    [[ "$STAGING_COMPOSE_OVERRIDE_FILE" =~ ^/[a-zA-Z0-9_./-]+$ &&
       "$STAGING_COMPOSE_OVERRIDE_FILE" != *'/../'* && "$STAGING_COMPOSE_OVERRIDE_FILE" != */.. ]]
fi
echo 'Staging workflow inputs are present and structurally valid.'
