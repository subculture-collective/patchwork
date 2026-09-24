#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT
bundle="$temporary/bundle"
fake_bin="$temporary/bin"
data_dir="$temporary/data"
metrics_dir="$temporary/metrics"
mkdir -p "$bundle/config" "$fake_bin" "$data_dir" "$metrics_dir"
cp "$root/deploy/routing/refresh-graph.sh" "$bundle/"

cat >"$bundle/fetch-inputs.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
directory="$1"
mkdir -p "$directory"
for file in chicago-cta.gtfs.zip chicago.osm.pbf otp-config.json build-config.json router-config.json inputs.manifest.json; do
    printf 'candidate-%s\n' "$file" >"$directory/$file"
done
printf '%s  chicago-cta.gtfs.zip\n' "${TEST_GTFS_SHA}" >"$directory/chicago-cta.gtfs.zip.sha256"
printf '%s  chicago.osm.pbf\n' "${TEST_OSM_SHA}" >"$directory/chicago.osm.pbf.sha256"
printf 'etag: candidate\n' >"$directory/chicago-cta.gtfs.zip.headers"
printf 'etag: candidate\n' >"$directory/chicago.osm.pbf.headers"
EOF
cat >"$bundle/build-graph.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf built >"${TEST_BUILD_MARKER}"
printf 'candidate-graph\n' >"$1/graph.obj"
(cd "$1" && sha256sum graph.obj >graph.obj.sha256)
EOF
chmod 0755 "$bundle"/*.sh

cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_DOCKER_LOG}"
EOF
cat >"$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
arguments="$*"
if [[ "$arguments" == *runtime.invalid* && "${TEST_RUNTIME_HEALTH:-up}" == down ]]; then
    exit 22
fi
if [[ "$arguments" == *'/otp/gtfs/v1'* ]]; then
    printf '{"data":{"planConnection":{"routingErrors":[],"edges":[{"node":{"duration":60,"legs":[{"mode":"WALK"}]}}]}}}\n'
else
    printf '{"status":"UP"}\n'
fi
EOF
chmod 0755 "$fake_bin"/*

seed_active() {
    rm -rf -- "$data_dir"
    mkdir -p "$data_dir"
    for file in chicago-cta.gtfs.zip chicago.osm.pbf otp-config.json build-config.json router-config.json inputs.manifest.json; do
        printf 'active-%s\n' "$file" >"$data_dir/$file"
    done
    printf 'active-gtfs  chicago-cta.gtfs.zip\n' >"$data_dir/chicago-cta.gtfs.zip.sha256"
    printf 'active-osm  chicago.osm.pbf\n' >"$data_dir/chicago.osm.pbf.sha256"
    printf 'etag: active\n' >"$data_dir/chicago-cta.gtfs.zip.headers"
    printf 'etag: active\n' >"$data_dir/chicago.osm.pbf.headers"
    printf 'active-graph\n' >"$data_dir/graph.obj"
    (cd "$data_dir" && sha256sum graph.obj >graph.obj.sha256)
}

export PATH="$fake_bin:$PATH"
export PATCHWORK_ROUTING_METRICS_FILE="$metrics_dir/routing.prom"
export PATCHWORK_ROUTING_HEALTH_URL='http://runtime.invalid/health'
export PATCHWORK_ROUTING_HEALTH_ATTEMPTS=1
export PATCHWORK_ROUTING_HEALTH_SLEEP_SECONDS=0
export TEST_BUILD_MARKER="$temporary/build-called"
export TEST_DOCKER_LOG="$temporary/docker.log"

seed_active
export TEST_GTFS_SHA=active-gtfs TEST_OSM_SHA=active-osm
"$bundle/refresh-graph.sh" "$data_dir"
test ! -e "$TEST_BUILD_MARKER"
grep -F 'last_attempt_success{environment="staging"} 1' "$PATCHWORK_ROUTING_METRICS_FILE" >/dev/null

seed_active
rm -f "$TEST_BUILD_MARKER" "$TEST_DOCKER_LOG"
export TEST_GTFS_SHA=new-gtfs TEST_OSM_SHA=new-osm TEST_RUNTIME_HEALTH=up
"$bundle/refresh-graph.sh" "$data_dir"
test -e "$TEST_BUILD_MARKER"
grep -F 'candidate-graph' "$data_dir/graph.obj" >/dev/null
grep -F 'restart patchwork-staging-routing' "$TEST_DOCKER_LOG" >/dev/null
test "$(find "$data_dir/previous" -type f -name graph.obj | wc -l)" -eq 1

seed_active
rm -f "$TEST_BUILD_MARKER" "$TEST_DOCKER_LOG"
export TEST_GTFS_SHA=newer-gtfs TEST_OSM_SHA=newer-osm TEST_RUNTIME_HEALTH=down
if "$bundle/refresh-graph.sh" "$data_dir"; then
    printf 'Expected runtime health failure.\n' >&2
    exit 1
fi
grep -F 'active-graph' "$data_dir/graph.obj" >/dev/null
grep -F 'last_attempt_success{environment="staging"} 0' "$PATCHWORK_ROUTING_METRICS_FILE" >/dev/null
test "$(grep -c '^restart patchwork-staging-routing$' "$TEST_DOCKER_LOG")" -eq 2
