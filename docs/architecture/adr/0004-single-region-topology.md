# ADR-0004: Keep a single-region deployment and one API service

- Status: Accepted (defer multi-region and service extraction)
- Date: 2026-10-30
- Issue: [#72](https://git.subcult.tv/subculture-collective/patchwork/issues/72)

## Context

Issue #72 asks whether Patchwork needs multi-region operation or separate
chat, scheduling, group or connector services. Earlier work modeled an
in-memory multi-region `TenantService` and a six-region failover runbook. That
code was removed as a retired expansion prototype; no regions, replication or
residency enforcement were ever deployed. This ADR replaces the runbook
(`docs/operations/multi-region-failover.md`), which described the removed code.

### Current deployment

One home-staging Compose project on one host runs every component: PostgreSQL
16, the API, web, indexer (spool, v2 shadow and backfill), moderation worker
(`patchwork-thimble`), MinIO for private attachments, ClamAV and the OTP
travel router. Source refresh and routing-graph refresh are host systemd
timers; source refresh runs its job inside the running API container. User PDSes and Jetstream are external
dependencies. Chat, scheduling and groups run inside the API process
([service boundaries](../service-boundaries.md)).

### Measured bottlenecks

The [October 30 capacity investigation](../../operations/evidence/national-capacity-2026-10-30.md)
(#20) is the current evidence. With two CPUs and 1 GiB each for the API and
PostgreSQL, 29,005 public-source records and 10,000 synthetic requests:

- At eight aggregate read RPS plus concurrent refresh/review work and real
  walking plans, every latency budget passed with zero errors. PostgreSQL CPU
  peaked at 40% of its quota, API memory at 29% and database connections at 17
  of 100.
- At 40 aggregate RPS, PostgreSQL saturated its two CPUs and directory p95 rose
  above two seconds. The limit is single-database query CPU, not network
  distance or process isolation.
- The host's shared root filesystem was below the staging disk-reserve gate.
  That is a host capacity problem; adding regions would not fix it.

No production traffic exists to measure. The pilot decision remains NO-GO
under #22.

### Failure domains

The host is a single failure domain for every component. Recovery relies on
six-hourly validated logical backups and an independent replication script
([disaster recovery](../../operations/disaster-recovery.md)). The documented
RPO target is below 15 minutes, but WAL archiving and point-in-time recovery
are not configured, so the achievable RPO is currently up to six hours. The
1-hour RTO is not yet qualified by an off-host restore (#17). External PDS and
Jetstream outages affect publication and indexing in any topology.

The availability SLO is 99.5% per 30 days, about 3.6 hours of allowed
downtime. A one-hour RTO restore fits within that budget for an occasional
host loss.

### Residency and governance

Public directory records come from public sources and are not personal data.
Private account, coordination, chat, attachment and moderation data are the
residency-relevant set. Current users and coverage are in the United States.
The Canadian and Mexican pilots (#54, #55) concern public-service directory
intake and do not by themselves require storing private data in those
countries. No legal requirement for in-country storage has been identified;
that question must be answered by privacy review before accounts are offered
outside the US.

### Ownership

One named operator holds home-staging on-call, escalation and incident command
as an interim single-person assignment ([RACI](../../operations/raci.md)).
Each additional region or service adds deployments, migrations, monitoring,
secrets and runbooks to that same person.

## Alternatives compared

| Option | What it buys | Cost and risk |
| --- | --- | --- |
| A. Current single host | Simple operation; one transaction boundary for coordination state | Host is a single failure domain; RPO up to six hours |
| B. A plus WAL archiving/PITR to independent storage (#75) | RPO in minutes; restores to a chosen time | Independent storage, key custody and continuity monitoring; no new runtime |
| C. B plus a warm PostgreSQL standby on a second home host | Faster recovery from host loss; read replica capacity | Replication monitoring, promotion runbook and fencing against split-brain; still one site and one operator |
| D. Multi-region active/passive | Survives site loss; could satisfy residency | Paid infrastructure, cross-region replication, regional secrets and deploys, consistency and failover drills; disproportionate to current load and staffing |
| E. Extract chat/scheduling/groups into services | Independent scaling and failure isolation per domain | Scheduling, chat and group mutations lock their rows and recheck connection or membership, block and moderation state in the same database transaction. A split would replace that with cross-service consistency protocols |

Source refresh already runs as a separate timer-driven job, executed inside
the API container. Giving it its own container is the smallest form of option
E; it would change packaging and resource isolation, not data ownership. The
capacity run measured refresh work alongside reads without errors.

## Decision

1. Keep one region and the current Compose topology. Do not build multi-region
   tenancy, failover routing or replication.
2. Keep chat, scheduling and groups inside the API. Do not extract services.
3. Address the measured limits in this order: query/index work, larger CPU and
   disk allocation for PostgreSQL and the host, PITR (#75), then a warm
   standby (option C) if drills show single-host recovery misses its targets.
4. Reopen this decision only when a trigger below is met. Any adopted change
   needs its own ADR with migration, compatibility and rollback plans.

## Trigger thresholds

Measure these on the deployed release; synthetic or historical results are
inputs, not triggers.

| Trigger | Threshold | First response |
| --- | --- | --- |
| Read capacity | Sustained peak aggregate read rate above 50% of the latest passing capacity envelope for the deployed hardware, or the API p95 SLO missed in more than 1% of 5-minute windows over 7 days | Query/index work and vertical scaling; read replica only after those are exhausted |
| Recovery | An off-host restore drill misses the 1-hour RTO, or the RPO target remains unmet after PITR | Warm standby (option C) |
| Availability | Unplanned downtime exceeds the 30-day 99.5% budget in two of three consecutive windows, with host loss as the cause | Warm standby (option C); multi-region only if a site-level failure caused it |
| Residency | Privacy review concludes that a supported jurisdiction requires private account or coordination data to be stored in-country | Region-specific deployment ADR for that jurisdiction |
| Domain isolation | One API domain accounts for more than half of API CPU in production profiles, or its failure breaches API-wide SLOs in a game day, after in-process limits are applied | Extract that domain only, with its own consistency design |
| Ownership | A second team takes on-call ownership of a domain | Re-evaluate the service boundary for that domain |

## Consequences

- `docs/operations/multi-region-failover.md` is removed; it described code that
  no longer exists and must not be treated as a capability.
- The current-state matrix records multi-region tenancy as not implemented.
- Recovery-point work stays in #17 and #75. Capacity regressions use the
  national regression profile in the capacity envelope.
- Canada/Mexico directory expansion can proceed without a topology change,
  subject to the residency trigger before accounts are offered there.
