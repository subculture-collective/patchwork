#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

container="${PATCHWORK_SOURCE_REFRESH_CONTAINER:-patchwork-staging-api}"
host_dir="${PATCHWORK_SOURCE_REFRESH_HOST_DIR:-/srv/patchwork-public/source-refresh}"
container_dir="${PATCHWORK_SOURCE_REFRESH_CONTAINER_DIR:-/var/lib/patchwork/source-refresh}"
max_bytes="${PATCHWORK_SOURCE_REFRESH_MAX_BYTES:-2147483648}"

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

[[ "$max_bytes" =~ ^[0-9]+$ ]] || { log 'ERROR: evidence limit must be an integer.'; exit 2; }
docker inspect "$container" >/dev/null
mkdir -p "$host_dir"
chmod 0750 "$host_dir"
current_bytes="$(du -sb "$host_dir" | awk '{print $1}')"
if (( current_bytes >= max_bytes )); then
    log "ERROR: retained evidence uses ${current_bytes} bytes, at or above the ${max_bytes}-byte limit."
    exit 1
fi
mount_source="$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "'"$container_dir"'"}}{{.Source}}{{end}}{{end}}')"
[[ "$mount_source" == "$host_dir" ]] || { log 'ERROR: API evidence bind mount does not match the configured host directory.'; exit 1; }

log 'Starting bounded Chicago publisher refresh.'
docker exec "$container" npm run resources:refresh:cpl-run -w @patchwork/api -- "$container_dir"
log 'Chicago publisher evidence and review candidates were persisted.'
