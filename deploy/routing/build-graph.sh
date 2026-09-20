#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

data_dir="${1:?Usage: build-graph.sh DATA_DIRECTORY}"
image='opentripplanner/opentripplanner@sha256:8d54e5c589186707ee365417f2202dc878c451fa3001b8edff07019531100933'
work_dir="$(mktemp -d "${data_dir}/.build.XXXXXX")"
cleanup() { rm -rf -- "$work_dir"; }
trap cleanup EXIT
exec 9>"${data_dir}/.build.lock"
flock -n 9 || { printf 'Another graph build is active.\n' >&2; exit 75; }

for file in chicago-cta.gtfs.zip chicago.osm.pbf otp-config.json build-config.json router-config.json inputs.manifest.json; do
    test -s "$data_dir/$file" || { printf 'Required input is missing: %s\n' "$file" >&2; exit 1; }
    ln "$data_dir/$file" "$work_dir/$file" 2>/dev/null || cp "$data_dir/$file" "$work_dir/$file"
done

docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=2g \
    --memory=8g --cpus=6 -e JAVA_TOOL_OPTIONS='-Xmx6g' \
    -v "$work_dir:/var/opentripplanner" "$image" --build --save
test -s "$work_dir/graph.obj"
(cd "$work_dir" && sha256sum graph.obj >graph.obj.sha256)
if test -s "$data_dir/graph.obj"; then
    stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
    mkdir -p "$data_dir/previous"
    mv "$data_dir/graph.obj" "$data_dir/previous/graph-${stamp}.obj"
    test ! -e "$data_dir/graph.obj.sha256" || mv "$data_dir/graph.obj.sha256" "$data_dir/previous/graph-${stamp}.obj.sha256"
fi
mv "$work_dir/graph.obj" "$data_dir/graph.obj"
mv "$work_dir/graph.obj.sha256" "$data_dir/graph.obj.sha256"
find "$data_dir/previous" -maxdepth 1 -type f -name 'graph-*.obj*' -mtime +120 -delete 2>/dev/null || true
printf 'Published graph %s\n' "$(cat "$data_dir/graph.obj.sha256")"
