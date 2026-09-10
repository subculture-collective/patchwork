#!/usr/bin/env bash
# Run the validated backup against the database configured by staging runtime.

set -Eeuo pipefail
umask 077

readonly api_container="${PATCHWORK_STAGING_API_CONTAINER:-patchwork-staging-api}"
readonly client_image="${PATCHWORK_POSTGRES_CLIENT_IMAGE:-postgres:17}"
readonly backup_script="${PATCHWORK_BACKUP_SCRIPT:-/srv/repos/subcult/patchwork/scripts/backup-postgres.sh}"
readonly backup_dir="${PATCHWORK_BACKUP_DIR:-/srv/backups/patchwork}"
readonly metrics_dir="${PATCHWORK_METRICS_DIR:-/srv/apps/monitoring/data/node-exporter-textfile}"
readonly docker_network="${PATCHWORK_BACKUP_DOCKER_NETWORK:-host}"

for command in docker node sed; do
    command -v "$command" >/dev/null
done
[[ -r "$backup_script" ]]
[[ "$(docker inspect -f '{{.State.Running}}' "$api_container")" == "true" ]]

database_url="$({
    docker inspect "$api_container" \
        --format '{{range .Config.Env}}{{println .}}{{end}}'
} | sed -n 's/^API_DATABASE_URL=//p')"
[[ -n "$database_url" ]]

url_component() {
    node -e '
        const url = new URL(process.argv[1]);
        const key = process.argv[2];
        const values = {
            host: url.hostname,
            port: url.port || "5432",
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            database: url.pathname.slice(1),
        };
        process.stdout.write(values[key]);
    ' "$database_url" "$1"
}

database_host="$(url_component host)"
database_port="$(url_component port)"
database_user="$(url_component user)"
database_password="$(url_component password)"
database_name="$(url_component database)"
readonly database_host database_port database_user database_password database_name

[[ -n "$database_host" && -n "$database_user" && -n "$database_name" ]]
install -d -m 0700 "$backup_dir"
install -d -m 0755 "$metrics_dir"
docker image inspect "$client_image" >/dev/null

docker run --rm --pull=never --network "$docker_network" \
    --volume "$backup_script:/backup-postgres.sh:ro" \
    --volume "$backup_dir:/backups/patchwork" \
    --volume "$metrics_dir:/metrics" \
    --env PGHOST="$database_host" \
    --env PGPORT="$database_port" \
    --env PGUSER="$database_user" \
    --env PGPASSWORD="$database_password" \
    --env PGDATABASE="$database_name" \
    --env BACKUP_DIR=/backups/patchwork \
    --env PATCHWORK_BACKUP_METRICS_FILE=/metrics/patchwork-backup.prom \
    "$client_image" bash /backup-postgres.sh
