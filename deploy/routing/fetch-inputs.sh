#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

data_dir="${1:?Usage: fetch-inputs.sh DATA_DIRECTORY}"
cta_url='https://www.transitchicago.com/downloads/sch_data/google_transit.zip'
osm_url='https://download.bbbike.org/osm/bbbike/Chicago/Chicago.osm.pbf'
max_gtfs_bytes=268435456
max_osm_bytes=268435456
lock_file="${data_dir}.fetch.lock"
mkdir -p "$data_dir"
exec 9>"$lock_file"
flock -n 9 || { printf 'Another routing input fetch is active.\n' >&2; exit 75; }

fetch() {
    local url="$1" destination="$2" max_bytes="$3" temporary headers size sha
    temporary="${destination}.tmp.$$"
    headers="${temporary}.headers"
    trap 'rm -f -- "$temporary" "$headers"' RETURN
    if ! curl --fail --silent --show-error --location --max-redirs 3 \
        --retry 3 --retry-all-errors --retry-delay 2 \
        --connect-timeout 15 --max-time 600 --max-filesize "$max_bytes" \
        --dump-header "$headers" --output "$temporary" "$url"; then
        rm -f -- "$temporary" "$headers"
        trap - RETURN
        return 1
    fi
    size="$(wc -c <"$temporary" | tr -d ' ')"
    (( size > 0 && size <= max_bytes )) || { printf 'Input size outside bound for %s.\n' "$url" >&2; return 1; }
    sha="$(sha256sum "$temporary" | awk '{print $1}')"
    chmod 0640 "$temporary"
    mv "$temporary" "$destination"
    printf '%s  %s\n' "$sha" "$(basename "$destination")" >"${destination}.sha256"
    awk 'BEGIN{IGNORECASE=1} /^etag:|^last-modified:|^content-length:/{gsub(/\r$/,""); print}' "$headers" >"${destination}.headers"
    trap - RETURN
    rm -f -- "$headers"
}

fetch "$cta_url" "$data_dir/chicago-cta.gtfs.zip" "$max_gtfs_bytes"
fetch "$osm_url" "$data_dir/chicago.osm.pbf" "$max_osm_bytes"
cp "$(dirname "$0")"/config/*.json "$data_dir/"
generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
cat >"$data_dir/inputs.manifest.json.tmp" <<EOF
{"generatedAt":"$generated_at","sources":{"cta":"$cta_url","osm":"$osm_url"},"files":{"gtfsSha256":"$(awk '{print $1}' "$data_dir/chicago-cta.gtfs.zip.sha256")","osmSha256":"$(awk '{print $1}' "$data_dir/chicago.osm.pbf.sha256")"}}
EOF
mv "$data_dir/inputs.manifest.json.tmp" "$data_dir/inputs.manifest.json"
