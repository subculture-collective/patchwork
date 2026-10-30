# Capacity targets and executable probe

## Status

The [October 30 national-directory investigation](evidence/national-capacity-2026-10-30.md)
records a controlled baseline and query repair against canonical main, with
national filters, concurrent refresh/review work, bounded real routing, browser
profiles and recovery measurements. Use its measured configuration and limits;
it does not certify NUC staging or the original modeled throughput targets.

Patchwork has an executable HTTP capacity probe, one bounded local PostgreSQL
result, and a historical five-minute mixed NUC home-staging result at
**40 aggregate read requests per second** across the four alpha routes
(10 RPS per route), alongside three real lifecycle journeys and three durable
moderation items. The August 7 re-certification failed under shared-host
contention; its separate 8-RPS zero-error soak established only that dated
stability point. Neither result establishes the capacity of today's release
or the expanded national directory and travel workload.

[Issue #20](https://git.subcult.tv/subculture-collective/patchwork/issues/20)
requires a controlled, named-release baseline with representative national
filters, concurrent refresh/review work, bounded travel traffic, browser
transfer/render costs, database and host headroom, and recovery. Preserve the
original throughput comparisons below. Historical observations are not
production sizing approval, a pilot `GO`, or a reliability commitment.

The older shared contracts in `packages/shared/src/load-testing.ts` contain
modeled targets for alpha and deferred routes. They are inputs to evaluation,
not measurements. Former references to `performance.test.ts`,
`load-profile.test.ts`, and `capacity-service.test.ts` were incorrect: those
files do not exist.

## Current alpha read workload

`npm run capacity:probe` sends real HTTP GET requests to the configured API.
It measures response-body completion, status counts, errors, achieved
throughput, and p50/p95/p99 latency. The probe is paced rather than saturation
based so it compares the current alpha routes with their modeled minimums.
Set `PATCHWORK_CAPACITY_PARALLEL_ROUTES=1` only for the controlled staging
drill to run all four read routes concurrently for the same bounded interval;
the default remains sequential to avoid surprising local load.
`PATCHWORK_CAPACITY_TARGET_RPS_PER_ROUTE` may set one explicit discovery rate
for every route during a controlled envelope search. Results must retain both
the configured rate and the higher modeled targets; an override must never be
reported as satisfying the original throughput budget.

| Endpoint | Path | Target RPS | p95 budget | Maximum error rate |
| --- | --- | ---: | ---: | ---: |
| health | `/health` | 50 | 30 ms | 0% |
| map | `/query/map` | 60 | 400 ms | 0.5% |
| feed | `/query/feed` | 80 | 300 ms | 0.5% |
| directory | `/query/directory` | 40 | 350 ms | 0.5% |

Map and feed use the generated, non-private coordinate tuple `0,0` with a
25 km radius. Query strings are never accepted as route configuration or
included in probe output. Base URLs containing credentials are rejected.

## Running the probe

Run against an already deployed or isolated API; the probe never starts,
seeds, or modifies a service:

```bash
PATCHWORK_CAPACITY_BASE_URL=http://127.0.0.1:44127 \
PATCHWORK_CAPACITY_ENVIRONMENT=isolated-local-postgres \
PATCHWORK_CAPACITY_DURATION_SECONDS=5 \
PATCHWORK_CAPACITY_CONCURRENCY=4 \
PATCHWORK_CAPACITY_ENFORCE_BUDGETS=1 \
npm run capacity:probe
```

When a trusted local load generator needs multiple client identities to avoid
measuring only the per-IP abuse limiter, set
`PATCHWORK_CAPACITY_FORWARDED_FOR_POOL_SIZE` to at most 254 and configure the
API to trust only that generator address. The probe uses the reserved
documentation range `198.51.100.0/24`. Do not enable this option against an
untrusted proxy or general public endpoint.

The command exits nonzero for any response error. With
`PATCHWORK_CAPACITY_ENFORCE_BUDGETS=1`, it also exits nonzero when latency,
throughput, or error-rate targets fail.

## Staging evidence gate

The staging drill must record a minimum five-minute mixed workload rather than
promoting a read-only benchmark into launch evidence. Its redacted JSON must
include read totals/latency, at least three complete create-to-projection
lifecycle journeys, at least three resolved durable moderation items, cleanup,
host/container/database headroom, error/restart deltas, event-source lag, and
post-workload readiness.

Validate that evidence with:

```bash
npm run capacity:staging:evaluate -- /restricted/path/staging-capacity.json
```

The evaluator fails closed when a required measurement is missing, any
workload errors, resource thresholds are exceeded, cleanup is incomplete, or
the services do not recover ready. It establishes a bounded alpha-staging
envelope, not a production maximum.

The home-staging gate requires at least 10 actual RPS on every route, p95 at or
below 500 ms, three completed lifecycle journeys with a conservative
create-to-projection upper bound at or below 30 seconds, three resolved
moderation items, and the resource/reliability limits enforced by
`staging-capacity.ts`.

## Interpreting results

Attach measurements to the tested release, including runtime revision, workload,
duration, latency, errors, resource use, and cleanup. A bounded staging probe
does not establish production saturation limits or multi-region capacity.

## National-directory regression profile

`node --import tsx scripts/run-national-capacity.mjs` measures eight simultaneous
scenarios against an explicitly seeded loopback API and a disposable database
named `patchwork_capacity_20`. It refuses remote database/API targets. Set
`API_DATABASE_URL`, `PATCHWORK_CAPACITY_BASE_URL`,
`PATCHWORK_CAPACITY_OUTPUT`, `PATCHWORK_CAPACITY_DURATION_SECONDS` (300 for
acceptance), and `PATCHWORK_CAPACITY_TARGET_RPS_PER_ROUTE`. The selected rate
applies to each scenario, including four separate directory queries. It is
not the aggregate directory rate or proof of the original throughput targets.

Seed all runtime-eligible public catalog records with `db:seed:resources --apply`
only in that disposable database. The synthetic request workload requires
10,000 explicitly labeled demo projections with public postal-area geography;
it never creates PDS records. Apply API, indexer and moderation migrations in
that order. Use a fresh database rather than copying private production data.

The harness runs real PostgreSQL preview, candidate persistence, immutable
replay and review-queue reads over synthetic publisher metadata every 30
seconds. It makes at most one real travel request per ten seconds, using a
generated landmark origin and an existing public library destination. Point
the isolated API at an authorized router and record its image and graph hash.
Travel responses are reduced to latency/status/itinerary counts; no origins
or itinerary details enter the result. This is a bounded walking/arrive-by
sample, not transit or device-location qualification. The isolated projection
heartbeat is synthetic and must never be described as live ingestion evidence.

For browser measurements, open the loopback production web build with
`playwright-cli`, then pass `scripts/profile-national-capacity-browser.js` to
`run-code`. Retain the returned JSON. It takes three cold-cache samples at
1440×1000 and three at 390×844 with fourfold CPU throttling. The web build must
use a same-origin `/api` proxy so CSP remains enforced. No geographic tile pack
is needed for the directory profile; map-tile loading is outside this result.

Evaluate the two evidence files with:

```bash
node scripts/evaluate-national-capacity.mjs CAPACITY.json BROWSER.json
```

The evaluator requires populated queries, five minutes of samples, the national
catalog, successful concurrent work, zero HTTP errors, recovered health and
95% of the configured paced rate. Existing health/map/feed/directory p95 and
p99 latency limits remain unchanged; national resource-map aggregation has a
500 ms p95 / 1200 ms p99 regression budget. Browser budgets are 1.5 MiB encoded
transfer, 20 rendered cards, and 2 seconds desktop / 4 seconds throttled mobile.
These are controlled regression limits, not a claim of real mobile-network
performance. CI exercises the evaluator's refusal cases; run the full profile
after material query, catalog-scale or bundle changes in a controlled setting.

`engineeringProfilePassed`, `modeledThroughputTargetsMet`, and
`homeStagingQualified` are separate results. The national evaluator never
qualifies home staging. Its raw evidence also records root/tmpfs storage,
container limits and memory, host memory/CPU counters, database connections
and lock waits. Review those before accepting a deployment envelope. In
particular, a shared root filesystem below the staging disk-reserve threshold
remains an operational blocker even when a disposable tmpfs benchmark passes.
