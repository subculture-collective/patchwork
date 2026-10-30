# National-directory capacity investigation, October 30, 2026

Issue: [#20](https://git.subcult.tv/subculture-collective/patchwork/issues/20).
The machine-readable measurements are in
[national-capacity-2026-10-30.json](national-capacity-2026-10-30.json).

## Tested release and boundary

The baseline is canonical main `240339b5172c55c0cd0bf021053002c7c4d8b833`,
whose Gitea push CI run 17542 passed both required contexts. The retained local
API image is `sha256:81ba9bf9eeefe90706ea89d2167f9a5641ff03abcd37e321bf6f2be8d11cdeeb`.
Treatment used that same image with a read-only bind of
`services/api/src/projected-discovery.ts`; the evidence records the treatment
file hash. This is an isolated source-patch experiment, not a newly built,
signed or deployed release.

The API and disposable PostgreSQL 16 each had two CPUs and a 1 GiB memory
limit. PostgreSQL data used a 768 MiB tmpfs. API, indexer and moderation
migrations applied to a fresh database: 39, 16 and 5 respectively. The catalog
import supplied 29,005 runtime-eligible public-source records from the five
checked-in snapshots; it preserved the closed-library exclusion. Another
10,000 synthetic request projections supplied populated feed/map queries.
No production database, personal data, OAuth identity or public PDS record was
copied or changed.

`NODE_ENV=test` disabled external-provider startup requirements while keeping
the real HTTP/PostgreSQL discovery path. A synthetic projection heartbeat
kept the isolated projections ready. It is not evidence of indexer ingestion,
PDS lifecycle performance or provider qualification. The web profile used the
production build of the same source with a same-origin `/api` proxy and CSP.

Travel calls went through the isolated API to the existing NUC OTP instance,
capped at one call per ten seconds. They used a generated Chicago landmark
origin and the nearest catalog library, alternating depart-at and arrive-by
walking plans. Only timings, status and itinerary counts were retained.
Router image: `sha256:8d54e5c589186707ee365417f2202dc878c451fa3001b8edff07019531100933`.
Graph: `6c7b3cef9b89784c9c6a04ce5e686ed7d73ea286bdca979e77f82ce9a39a1481`.
This does not measure transit capacity, device location, wheelchair semantics
or router saturation. The router was not restarted or reconfigured.

## Workload and bottlenecks

Eight scenarios ran concurrently: health, populated demo request map/feed,
Chicago directory, New York food, Los Angeles health, national housing search
on page two, and a contiguous-US resource-map viewport. Every scenario had
a populated/valid response preflight. The configured RPS applies to each
scenario; directory traffic is the sum of its four scenarios.

Every 30 seconds, a separate worker ran the real national-listing preview,
candidate persistence, immutable replay and reviewer queue read paths using
clearly synthetic publisher metadata. It did not fetch a publisher, apply
public changes or renew existing evidence on replay. Host/container/database
samples recorded CPU counters, memory, disk, connection use and lock waiters.

The initial 30-second, five-RPS-per-scenario baseline failed: national-map
p95 reached the five-second timeout and 24 requests failed. Regional-directory
p95 was about 2.6–2.8 seconds. PostgreSQL saturated its two-CPU limit. A
read-only plan capture also occurred during this diagnostic run, so small
differences must not be interpreted as a precise speedup estimate.

The baseline Chicago query resolved address eligibility separately for 28,924
non-library rows. The repair materializes one address relation with the same
reviewed-before-source precedence, then reuses it for geographic filtering,
page hydration and map cells. Bytewise URI sorting avoids unnecessary locale
comparison work. Service/program evidence filters now build a matching set
once instead of repeating publisher lookups for each candidate. Profiling
the intermediate service query showed 54 ms of query-compilation overhead;
the final set-based filter avoids that repeated-work plan.

A first five-minute treatment run completed without HTTP or background errors
but missed the 350 ms directory p95 budget for New York food and Los Angeles
health (about 381/383 ms). It remains retained as a failed result. The final
five-minute run and the matched higher-rate comparison are recorded in the
JSON, including all latency/error and resource limits. No failed run was
relabeled as a pass.

## Final measurements and bounded envelope

The final five-minute profile passed all eight query-latency and browser
regression budgets at **one RPS per scenario: eight aggregate read RPS**, plus
one real walking-plan call per ten seconds. All 2,400 HTTP reads succeeded;
ten refresh/persistence/replay cycles, thirty real itinerary requests and
43 resource samples completed without background errors. This is the accepted
controlled regression point for the stated two-CPU containers, catalog and
workload. No interpolation to a higher sustained rate is justified.

| Scenario | Actual RPS | p95 ms | p99 ms | Errors |
| --- | ---: | ---: | ---: | ---: |
| Health | 1 | 8.32 | 9.66 | 0 |
| Demo request map | 1 | 28.34 | 86.31 | 0 |
| Demo request feed | 1 | 17.14 | 19.85 | 0 |
| Chicago directory | 1 | 201.80 | 208.15 | 0 |
| New York food | 1 | 286.69 | 303.12 | 0 |
| Los Angeles health | 1 | 285.84 | 310.22 | 0 |
| National housing search, page two | 1 | 194.76 | 203.74 | 0 |
| National resource map | 1 | 408.12 | 464.78 | 0 |

Walking plans had 71.21 ms p95 and 80.72 ms p99. Peak observed API and database
memory were 29.12% and 31.63% of their respective 1 GiB limits. Peak database
connections were 17 of 100, with no sampled lock waiters; database size peaked
at about 156 MiB. Host available-memory headroom stayed above 42.69%; sampled
host CPU peaked at 37.25%. Peak database CPU was 80.56% of one core, or 40.28%
of its two-core quota. These sampled maxima are not continuous peak guarantees.

The matched five-RPS-per-scenario rerun still exceeded latency budgets and
missed configured throughput on several scenarios. It had zero HTTP errors,
including the national map that timed out 24 requests in the baseline. Its
regional-directory p95 was about 2.2–2.3 seconds and national-map p95 about
2.3 seconds. This higher requested aggregate rate of 40 RPS is **outside the
accepted envelope**. The repair removes the reproduced timeout failure; it
does not establish sufficient capacity at that load.

Post-load API health completed in 5.26 ms. A separate controlled failure test
paused only the disposable database for 2.08 seconds. The client timed out as
expected while it was paused; after unpause, full API health recovered in
8.68 ms with the same API PID, no OOM kill and all 29,005 catalog records intact.
No production service was interrupted.

The national evaluator reports `engineeringProfilePassed: true`,
`modeledThroughputTargetsMet: false`, and `homeStagingQualified: false`.
The existing staging evaluator also refused the explicitly non-staging evidence:
it does not supply staging lifecycle/moderation/ingestion qualification, the
per-route staging throughput minimum, or the required root-disk reserve. Actual
measured headroom was supplied where available; missing provider evidence was
not fabricated to fill its contract.

## Browser and correctness checks

Three cold-cache desktop profiles at 1440×1000 rendered 20 cards in 144–250 ms.
Three cold-cache 390×844 profiles with fourfold CPU throttling rendered the
same 20 cards in 248–385 ms. Encoded transfer was about 1.18 MiB. These are
local-network, controlled browser results, not physical-device or slow-network
qualification. The JSON also retains decoded bytes, DOM size and browser
script/layout/task metrics.

Baseline/treatment Chicago, national-map and national-search responses matched
after excluding changing freshness metadata. Fresh PostgreSQL checks cover
reviewed-address precedence, map counts, revocation fallback, publisher service
and program evidence, and withdrawn listings. All 16 selected query/refresh
tests passed. API typecheck, operational tests and evaluator refusal cases
passed. Hosted PR checks remain a separate delivery requirement.

Raw local evidence, including failed runs and query plans, is retained outside
Git under `~/.local/state/patchwork/capacity/2026-10-30/`. The public JSON contains
redacted aggregate measurements and hashes for the principal raw artifacts.
Reverting the query patch restores the prior read plan; there is no schema
migration or public-data mutation to roll back. The disposable database and
temporary API/web containers are removed after measurement.

## Operating decision

The evidence defines a controlled regression profile, not a production maximum.
Keep the original targets visible: health 50 RPS, request map 60, feed 80 and
directory 40, with their existing p95/p99/error limits. A lower configured
benchmark rate does not meet those modeled throughput targets.

The shared host root filesystem had only about 4 GiB free, far below the
staging evaluator's 15% disk-reserve gate. The benchmark's independent tmpfs
prevented database churn from consuming that reserve; it does not repair the
host or authorize production traffic. The current operational decision remains
NO-GO. Do not infer NUC staging capacity from Kvant's constrained containers.

Use the [national regression profile](../capacity-envelope.md#national-directory-regression-profile)
after material query/catalog/bundle changes. Its evaluator retains the original
latency budgets, checks configured throughput, populated samples, concurrent
work, recovery and browser limits, and reports modeled throughput separately.
The home-staging evaluator remains responsible for its stricter independent
lifecycle, moderation, storage, ingestion and operational requirements. It
must not be fed fabricated provider or staging data to accept this experiment.
