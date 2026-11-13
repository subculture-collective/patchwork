#!/usr/bin/env bash
set -euo pipefail
: "${STAGING_SSH_USER:?Set STAGING_SSH_USER}"
: "${STAGING_SSH_HOST:?Set STAGING_SSH_HOST}"
run_id=${GITHUB_RUN_ID:-manual}
[[ "$STAGING_SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$STAGING_SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$run_id" =~ ^(manual|[0-9]+)$ ]]
# The host runs scripts/reset-staging-test-blocks.py from the deployed commit.
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
    "$STAGING_SSH_USER@$STAGING_SSH_HOST" "reset-test-blocks $run_id" < /dev/null
