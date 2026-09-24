#!/usr/bin/env bash
# Called in a per-run transfer directory on the staging host.
set -Eeuo pipefail
env_file=${1:?Usage: run-staging-release.sh ENV_FILE LOCK_FILE}
lock_file=${2:?Usage: run-staging-release.sh ENV_FILE LOCK_FILE}
: "${COMPOSE_PROJECT_NAME:?Set the existing staging Compose project name}"
state_dir=${PATCHWORK_RELEASE_STATE_DIR:-/var/lib/patchwork/releases}

exec 9>"$lock_file"
flock -n 9 || { echo 'Another staging deployment holds the host lock.' >&2; exit 1; }

# A trust failure must never roll a healthy current release back to an older one.
./verify-release-trust.sh artifact-digests.json
current="$state_dir/current-artifact-digests.json"
previous="$state_dir/previous-artifact-digests.json"
baseline=$(mktemp)
trap 'rm -f "$baseline"' EXIT
if [[ -f "$current" ]]; then
    (cd "$state_dir" && sha256sum -c current-artifact-digests.json.sha256)
    cp "$current" "$baseline"
fi

if ./deploy-staging-digests.sh artifact-digests.json "$env_file" docker-compose.staging.yml; then
    exit 0
fi

# The deploy script retains current as previous before its first Compose change.
# Never use a stale previous manifest when admission or retention failed.
if [[ -s "$baseline" && -r "$previous" ]] && cmp -s "$baseline" "$previous"; then
    ./rollback-staging-digests.sh "$env_file" docker-compose.staging.yml
else
    echo 'Deployment failed without a matching rollback baseline; operator recovery required.' >&2
fi
exit 1
