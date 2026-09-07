# Capacity targets and executable probe

## Status

Patchwork has an executable HTTP capacity probe, one bounded local PostgreSQL
result, and a five-minute mixed NUC home-staging result. The validated staging
envelope is **40 aggregate read requests per second** across the four alpha
routes (10 RPS per route), alongside three real lifecycle journeys and three
durable moderation items. This is a safe observed home-staging operating
point, not a saturation result, production sizing claim, alpha `GO`, or
reliability commitment.

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
