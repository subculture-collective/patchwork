#!/usr/bin/env bash
set -euo pipefail

env_file=${1:?Usage: rollback-staging-digests.sh ENV_FILE [COMPOSE_FILE]}
compose_file=${2:-docker-compose.staging.yml}
state_dir=${PATCHWORK_RELEASE_STATE_DIR:-/var/lib/patchwork/releases}
manifest="$state_dir/previous-artifact-digests.json"
manifest_checksum="${manifest}.sha256"

[[ -r "$manifest" && -r "$manifest_checksum" ]] || {
    echo 'No verified previous-artifact-digests.json is available.' >&2
    exit 1
}
(cd "$state_dir" && sha256sum -c "$(basename "$manifest_checksum")")
git_sha=$(jq -er '.gitSha' "$manifest")
[[ "$git_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Refusing rollback manifest without a full Git SHA.' >&2
    exit 1
}
map_tile_url=$(jq -er '.mapTileUrl' "$manifest")
[[ "$map_tile_url" =~ ^/tiles/us\.[0-9a-f]{64}\.pmtiles$ ]] || {
    echo 'Refusing rollback manifest without a content-addressed map tile URL.' >&2
    exit 1
}
export STAGING_VITE_MAP_TILE_URL="$map_tile_url"
export STAGING_PATCHWORK_PM_TILES_FILENAME="${map_tile_url##*/}"
export VITE_MAP_TILE_URL="$map_tile_url"
export PATCHWORK_PM_TILES_FILENAME="${map_tile_url##*/}"

expected_web_api_base_url=${PATCHWORK_EXPECTED_WEB_API_BASE_URL:-}
if [[ -n "$expected_web_api_base_url" &&
      ! "$expected_web_api_base_url" =~ ^(https://|/) ]]; then
    echo 'Refusing a browser API base URL that is not HTTPS or same-origin.' >&2
    exit 1
fi

for service in api indexer moderation web; do
    image=$(jq -er ".images.${service}" "$manifest")
    [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || exit 1
    case "$service" in
        api) export PATCHWORK_API_IMAGE=$image ;;
        indexer) export PATCHWORK_INDEXER_IMAGE=$image ;;
        moderation) export PATCHWORK_MODERATION_IMAGE=$image ;;
        web) export PATCHWORK_WEB_IMAGE=$image ;;
    esac
done

compose=(docker compose --env-file "$env_file" -f "$compose_file")
if [[ -n "${PATCHWORK_COMPOSE_OVERRIDE_FILE:-}" ]]; then
    [[ -r "$PATCHWORK_COMPOSE_OVERRIDE_FILE" ]]
    compose+=(-f "$PATCHWORK_COMPOSE_OVERRIDE_FILE")
fi
"${compose[@]}" pull
# A pre-v2 indexer image cannot safely run the v2 shadow service. The live v1
# projection and checkpoint remain the rollback target.
"${compose[@]}" stop patchwork-v2-shadow >/dev/null 2>&1 || true
"${compose[@]}" rm -f patchwork-v2-shadow >/dev/null 2>&1 || true
"${compose[@]}" up -d --no-build --no-deps \
    patchwork-spool patchwork-thimble patchwork-api patchwork-web

for service in \
    patchwork-spool \
    patchwork-thimble \
    patchwork-api \
    patchwork-web; do
    container_id=$("${compose[@]}" ps -q "$service")
    [[ -n "$container_id" ]]
    revision=$(docker inspect --format \
        '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$container_id")
    [[ "$revision" == "$git_sha" ]] || {
        echo "Revision mismatch for ${service}: ${revision} != ${git_sha}." >&2
        exit 1
    }
done

for probe in 'patchwork-spool:4100' 'patchwork-thimble:4200' 'patchwork-api:4000'; do
    service=${probe%%:*}; port=${probe##*:}
    for attempt in {1..30}; do
        if "${compose[@]}" exec -T "$service" \
            wget -qO- "http://127.0.0.1:${port}/health/ready" >/dev/null 2>&1; then
            break
        fi
        [[ $attempt -lt 30 ]] || exit 1
        sleep 2
    done
done

"${compose[@]}" exec -T patchwork-web sh -ceu \
    'grep -R -F -- "$1" /usr/share/nginx/html/assets >/dev/null' \
    _ "$map_tile_url"
if [[ -n "$expected_web_api_base_url" ]]; then
    "${compose[@]}" exec -T patchwork-web sh -ceu \
        'grep -R -F -- "$1" /usr/share/nginx/html/assets >/dev/null' \
        _ "$expected_web_api_base_url" || {
        echo 'Rolled-back web bundle does not contain the expected API base URL.' >&2
        exit 1
    }
fi
tile_bytes=$("${compose[@]}" exec -T patchwork-web sh -ceu \
    'curl -fsS --range 0-1023 "http://127.0.0.1$1" | wc -c' \
    _ "$map_tile_url")
[[ "$tile_bytes" -eq 1024 ]] || {
    echo "Map tile range probe returned ${tile_bytes} bytes instead of 1024." >&2
    exit 1
}
if "${compose[@]}" exec -T patchwork-web \
    wget -qO- http://127.0.0.1/tiles/us.pmtiles >/dev/null 2>&1; then
    echo 'Unversioned map tile URL must return 404.' >&2
    exit 1
fi

cp "$manifest" "$state_dir/current-artifact-digests.json"
sha256sum "$state_dir/current-artifact-digests.json" \
    > "$state_dir/current-artifact-digests.json.sha256"
echo "Rolled staging back to ${git_sha}."
