#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

data_dir="${1:-/srv/patchwork-routing}"
runtime_container="${PATCHWORK_ROUTING_CONTAINER:-patchwork-staging-routing}"
runtime_health_url="${PATCHWORK_ROUTING_HEALTH_URL:-http://127.0.0.1:3080/otp/actuators/health}"
candidate_port="${PATCHWORK_ROUTING_CANDIDATE_PORT:-3081}"
metrics_file="${PATCHWORK_ROUTING_METRICS_FILE:-/srv/server/monitoring/data/node-exporter-textfile/patchwork-routing-refresh.prom}"
health_attempts="${PATCHWORK_ROUTING_HEALTH_ATTEMPTS:-120}"
health_sleep_seconds="${PATCHWORK_ROUTING_HEALTH_SLEEP_SECONDS:-2}"
image='opentripplanner/opentripplanner@sha256:8d54e5c589186707ee365417f2202dc878c451fa3001b8edff07019531100933'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
candidate=''
validation_container=''
backup_dir=''
published=0

write_metrics() {
    local success="$1" completed_at="${2:-0}" gtfs_sha="${3:-unknown}" osm_sha="${4:-unknown}" graph_sha="${5:-unknown}"
    local directory temporary
    directory="$(dirname -- "$metrics_file")"
    test -d "$directory" || return 0
    temporary="${metrics_file}.tmp.$$"
    cat >"$temporary" <<EOF
# HELP patchwork_routing_graph_refresh_last_attempt_success Whether the latest scheduled routing graph refresh completed safely.
# TYPE patchwork_routing_graph_refresh_last_attempt_success gauge
patchwork_routing_graph_refresh_last_attempt_success{environment="staging"} ${success}
# HELP patchwork_routing_graph_refresh_last_success_timestamp_seconds Unix time of the latest safe routing graph refresh or no-change verification.
# TYPE patchwork_routing_graph_refresh_last_success_timestamp_seconds gauge
patchwork_routing_graph_refresh_last_success_timestamp_seconds{environment="staging"} ${completed_at}
# HELP patchwork_routing_graph_build_info Hash identity of the active routing inputs and graph.
# TYPE patchwork_routing_graph_build_info gauge
patchwork_routing_graph_build_info{environment="staging",gtfs_sha256="${gtfs_sha}",osm_sha256="${osm_sha}",graph_sha256="${graph_sha}"} 1
EOF
    chmod 0644 "$temporary"
    mv "$temporary" "$metrics_file"
}

read_hash() {
    local path="$1"
    test -s "$path" && awk 'NR == 1 {print $1}' "$path" || printf unknown
}

cleanup() {
    if test -n "$validation_container"; then
        docker rm --force "$validation_container" >/dev/null 2>&1 || true
    fi
    if test -n "$candidate"; then
        rm -rf -- "$candidate"
    fi
}

on_error() {
    local status=$?
    trap - ERR
    if [[ "$published" == 1 && -n "$backup_dir" && -d "$backup_dir" ]]; then
        for file in "$backup_dir"/*; do
            install -m 0640 "$file" "$data_dir/$(basename "$file")"
        done
        docker restart "$runtime_container" >/dev/null 2>&1 || true
        printf 'Routing publication failed; previous release restored.\n' >&2
    fi
    write_metrics 0 0 \
        "$(read_hash "$data_dir/chicago-cta.gtfs.zip.sha256")" \
        "$(read_hash "$data_dir/chicago.osm.pbf.sha256")" \
        "$(read_hash "$data_dir/graph.obj.sha256")"
    exit "$status"
}

trap cleanup EXIT
trap on_error ERR

install -d -m 0750 "$data_dir" "$data_dir/candidates" "$data_dir/previous"
exec 9>"$data_dir/.refresh.lock"
flock -n 9 || { printf 'Another routing refresh is active.\n' >&2; exit 75; }

candidate="$(mktemp -d "$data_dir/candidates/refresh.XXXXXX")"
"$script_dir/fetch-inputs.sh" "$candidate"

candidate_gtfs="$(read_hash "$candidate/chicago-cta.gtfs.zip.sha256")"
candidate_osm="$(read_hash "$candidate/chicago.osm.pbf.sha256")"
active_gtfs="$(read_hash "$data_dir/chicago-cta.gtfs.zip.sha256")"
active_osm="$(read_hash "$data_dir/chicago.osm.pbf.sha256")"
active_graph="$(read_hash "$data_dir/graph.obj.sha256")"

if [[ "$candidate_gtfs" == "$active_gtfs" && "$candidate_osm" == "$active_osm" ]]; then
    completed_at="$(date -u '+%s')"
    write_metrics 1 "$completed_at" "$active_gtfs" "$active_osm" "$active_graph"
    printf 'Routing inputs are unchanged; active graph retained.\n'
    exit 0
fi

"$script_dir/build-graph.sh" "$candidate"
(cd "$candidate" && sha256sum -c graph.obj.sha256)
candidate_graph="$(read_hash "$candidate/graph.obj.sha256")"

validation_container="patchwork-routing-validation-$$"
docker run --detach --rm --name "$validation_container" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=1g \
    --memory=5g --cpus=3 -e JAVA_TOOL_OPTIONS='-Xmx4g' \
    --publish "127.0.0.1:${candidate_port}:8080" \
    --volume "$candidate:/var/opentripplanner:ro" \
    "$image" --load --serve >/dev/null

for _ in $(seq 1 "$health_attempts"); do
    if curl --fail --silent "http://127.0.0.1:${candidate_port}/otp/actuators/health" >/dev/null; then
        break
    fi
    sleep "$health_sleep_seconds"
done
curl --fail --silent "http://127.0.0.1:${candidate_port}/otp/actuators/health" >/dev/null

query_file="$candidate/qualification-query.json"
jq -n --arg departure "$(date -u -d '+10 minutes' '+%Y-%m-%dT%H:%M:%SZ')" '{
  query: "query RefreshQualification($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput!, $modes: PlanModesInput!) { planConnection(origin:$origin,destination:$destination,dateTime:$dateTime,modes:$modes,first:1,searchWindow:\"PT1H\") { routingErrors { description } edges { node { duration legs { mode } } } } }",
  operationName: "RefreshQualification",
  variables: {
    origin: {location:{coordinate:{latitude:41.881832,longitude:-87.623177}}},
    destination: {location:{coordinate:{latitude:41.8955,longitude:-87.6243}}},
    dateTime: {earliestDeparture:$departure},
    modes: {direct:["WALK"],transit:{access:["WALK"],egress:["WALK"],transfer:["WALK"]}}
  }
}' >"$query_file"
curl --fail --silent --show-error \
    --header 'content-type: application/json' \
    --data-binary "@$query_file" \
    "http://127.0.0.1:${candidate_port}/otp/gtfs/v1" \
    | jq -e '.errors == null and (.data.planConnection.routingErrors | length) == 0 and (.data.planConnection.edges | length) > 0' >/dev/null
docker rm --force "$validation_container" >/dev/null
validation_container=''

stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
backup_dir="$data_dir/previous/refresh-$stamp"
install -d -m 0750 "$backup_dir"
for file in chicago-cta.gtfs.zip chicago-cta.gtfs.zip.headers chicago-cta.gtfs.zip.sha256 \
    chicago.osm.pbf chicago.osm.pbf.headers chicago.osm.pbf.sha256 \
    otp-config.json build-config.json router-config.json inputs.manifest.json graph.obj graph.obj.sha256; do
    test ! -e "$data_dir/$file" || cp --preserve=mode,timestamps "$data_dir/$file" "$backup_dir/$file"
done

# Publish the graph last. A failure before that point leaves the active graph in
# place; the complete previous release remains available for rollback.
published=1
for file in chicago-cta.gtfs.zip chicago-cta.gtfs.zip.headers chicago-cta.gtfs.zip.sha256 \
    chicago.osm.pbf chicago.osm.pbf.headers chicago.osm.pbf.sha256 \
    otp-config.json build-config.json router-config.json inputs.manifest.json graph.obj.sha256 graph.obj; do
    install -m 0640 "$candidate/$file" "$data_dir/.${file}.new"
    mv "$data_dir/.${file}.new" "$data_dir/$file"
done

docker restart "$runtime_container" >/dev/null
for _ in $(seq 1 "$health_attempts"); do
    if curl --fail --silent "$runtime_health_url" >/dev/null; then
        break
    fi
    sleep "$health_sleep_seconds"
done
if ! curl --fail --silent "$runtime_health_url" >/dev/null; then
    printf 'New graph failed runtime health.\n' >&2
    false
fi
published=0

find "$data_dir/previous" -mindepth 1 -maxdepth 1 -type d -name 'refresh-*' -mtime +120 -exec rm -rf -- {} +
completed_at="$(date -u '+%s')"
write_metrics 1 "$completed_at" "$candidate_gtfs" "$candidate_osm" "$candidate_graph"
printf 'Published and activated routing graph %s\n' "$candidate_graph"
