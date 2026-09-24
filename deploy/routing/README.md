# Chicago routing service

Patchwork uses a dedicated OpenTripPlanner 2.10 process for Chicago walking and
CTA itinerary searches. The container image is pinned by multi-architecture
digest. Precise origins enter the API only in `POST /travel/plan`, pass directly
to the internal GTFS GraphQL endpoint, and are absent from application logs,
URLs, browser storage, database tables, and normalized responses.

Prepare a durable host directory and fetch bounded official inputs:

```sh
sudo install -d -m 0750 /srv/patchwork-routing
sudo ./deploy/routing/fetch-inputs.sh /srv/patchwork-routing
sudo ./deploy/routing/build-graph.sh /srv/patchwork-routing
```

The fetch limits are 256 MiB each for CTA GTFS and the daily BBBike Chicago OSM
extract. Each input gets a SHA-256 sidecar and selected publisher response
headers. Graph publication is atomic; the previous graph is retained for 120
days. The build container defaults to three CPUs, 8 GiB memory, and a 6 GiB JVM
heap. Operators can set `PATCHWORK_ROUTING_BUILD_CPUS` for a larger build host.

Start the router without activating app traffic:

```sh
STAGING_ROUTING_BIND_ADDRESS=10.0.0.56 \
STAGING_ROUTING_DATA_DIRECTORY=/srv/patchwork-routing \
docker compose --profile routing -f docker-compose.staging.yml up -d patchwork-routing
curl --fail http://10.0.0.56:3080/otp/actuators/health
```

Add the jobs in `monitoring/prometheus/patchwork-scrape-jobs.yml` to central
Prometheus and load `monitoring/prometheus/patchwork-alerts.yml`. Exercise known
walk, bus, and rail trips, an unreachable destination, cancellation, eight
concurrent requests, and wheelchair preferences. Record graph/input hashes and
results. Only then set
`STAGING_API_ROUTING_SERVICE_URL=http://patchwork-staging-routing:8080/otp/gtfs/v1`
and recreate the API container.

Actuator health, GraphQL schema acceptance, and a successful local itinerary do
not qualify Chicago coverage or accessibility. The post-activation observation
window and real itinerary checks in `docs/quality-gates.md` remain required.

## Scheduled maintenance

Install `fetch-inputs.sh`, `build-graph.sh`, `refresh-graph.sh`, and `config/`
under `/usr/local/libexec/patchwork-routing`, then install and enable
`patchwork-routing-refresh.timer`. The weekly job fetches bounded current CTA
and Chicago OSM inputs into an isolated candidate directory. It skips a rebuild
when both input hashes are unchanged. Changed inputs must build successfully,
load in an isolated resource-limited OTP container, and return a real Chicago
transit itinerary before publication. The active input set and graph are backed
up together, the runtime is restarted only after candidate qualification, and
a failed runtime health check restores the previous release.

The job writes node-exporter textfile metrics for its last attempt, last safe
completion, and active GTFS, OSM, and graph hashes. Prometheus warns after a
failed run or ten days without a safe refresh check. Previous releases are
retained for 120 days.
