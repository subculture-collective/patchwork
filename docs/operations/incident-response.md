# Incident Response Runbook

Tracks: #105 (Incident response runbook and game day), #75 (Epic D -- Reliability & Observability)

---

## 1. Severity Classification

Severity levels align with the [Alerting Policy](alerting-policy.md) and
the escalation ladder in the [RACI Matrix](raci.md).

| Priority | Severity | Description | Examples | Response Time |
|----------|----------|-------------|----------|---------------|
| **P1** | Critical | Complete outage or data-loss risk affecting all users | `service_down`, `error_rate_high`, `checkpoint_stale` | 5 minutes |
| **P2** | Warning | Major feature degraded; workaround may exist | `latency_p95_high`, `queue_depth_high`, `disk_usage_high` | 15 minutes |
| **P3** | Info | Minor degradation with limited user impact | Elevated latency below threshold, intermittent UI errors | Daily review |
| **P4** | Low | Cosmetic or non-urgent issue | Log warnings, UI alignment bugs | Next sprint |

---

## 2. Incident Commander Role and Responsibilities

### 2.1 Who Is the IC?

The Incident Commander is activated for any **P1** or **P2** incident. By
default, the on-call Infrastructure engineer assumes the IC role. For the
current home-staging environment, Patrick Fanella is the named primary on-call,
escalation owner, and default IC. Any senior engineer may assume the role if:

- The INFRA on-call is unavailable
- The incident is primarily a trust-safety or product concern
- A handoff is needed due to fatigue or timezone

### 2.2 IC Responsibilities

1. **Own the incident** -- single point of coordination and decision-making.
2. **Establish communication** -- open a dedicated incident channel (e.g.,
   `#incident-YYYYMMDD-<slug>`) and post the initial status message.
3. **Assign roles** -- delegate investigation, mitigation, and communication.
4. **Authorize mitigation** -- approve rollbacks, feature flags, traffic shifts.
5. **Provide status updates** -- at minimum every 15 minutes for P1, every
   30 minutes for P2.
6. **Declare resolution** -- confirm the incident is resolved or downgraded.
7. **Schedule post-incident review** -- within 48 hours for P1, 1 week for P2.

### 2.3 IC Handoff

1. Announce handoff intent in the incident channel.
2. Provide a written summary: current status, actions taken, open threads,
   pending decisions.
3. Incoming IC acknowledges and confirms context.
4. Announce: "IC is now @incoming-engineer as of HH:MM UTC."
5. Outgoing IC remains available for 30 minutes after handoff.

---

## 3. Communication Templates

### 3.1 Internal -- Incident Channel Opening

```
[P<N> INCIDENT] <title>
Detected: YYYY-MM-DD HH:MM UTC
IC: @<name>
Status: Investigating

Summary:
<1-2 sentence description of symptoms>

Impact:
<Which users/features are affected>

Current actions:
- <what is being done>

Next update: HH:MM UTC
```

### 3.2 Internal -- Status Update

```
[UPDATE] <title> (P<N>)
Time: YYYY-MM-DD HH:MM UTC
IC: @<name>
Status: Investigating | Mitigating | Monitoring | Resolved

Changes since last update:
- <actions taken and findings>

Current hypothesis:
<what we think is happening>

Next steps:
- <planned actions>

Next update: HH:MM UTC
```

### 3.3 External -- Status Page (Initial)

```
Investigating: <user-facing feature> is experiencing <degraded performance | errors | downtime>

We are aware of an issue affecting <feature>. Our team is actively
investigating. We will provide updates as we learn more.

Posted: YYYY-MM-DD HH:MM UTC
```

### 3.4 External -- Status Page (Resolved)

```
Resolved: <user-facing feature> issue has been resolved

The issue affecting <feature> has been resolved as of HH:MM UTC.
<Brief description of what happened and what was done>.
We apologize for the inconvenience.

Posted: YYYY-MM-DD HH:MM UTC
```

---

## 4. Response Procedures by Alert Type

Each procedure references the executable Prometheus rules defined in
[alerting-policy.md](alerting-policy.md). Services emit source metrics and
redacted structured operational events; Prometheus and the external alert
receiver evaluate and deliver alerts.

### API error rate

Confirm the failing route from SLI counters and logs, verify PostgreSQL and PDS
health, then roll back the immutable four-image manifest if the regression
started with the current release. Never enable fixture fallback as mitigation.

### Indexer disconnect or lag

Check `patchwork_event_source_connected`, event-source lag, checkpoint health,
and PostgreSQL readiness. Restarting the indexer is safe only after recording
the last durable cursor; prove that it resumes from that cursor and does not
duplicate projections. Escalate if the source remains disconnected for ten
minutes.

### Moderation queue age

Inspect the oldest durable queued case, lease owner and expiry, retry time, and
last failure code. Recover expired leases or repair the failing dependency;
never delete cases merely to clear the gauge. For an urgent-notification alert,
confirm that a configured moderator role and channel exist, restore the
notification sweep, and verify the durable event is consumed exactly once.
Never copy the subject submission, contact data, exact location, or private
attachment into incident notes.

### Maintenance mode

Confirm an incident commander owns the declared reason and that public reads
and `/status` remain healthy while every new-submission and exact-location
write returns the stable maintenance response. Do not resume to clear the
alert. A moderator with `maintenance_mode:manage` may resume only after the
declared privacy, authorization, abuse, integrity, backlog, monitoring, or
backup condition is verified healthy; the resume must appear in the durable
audit log. An environment override must be cleared through the deployment
configuration before an in-product resume is possible.

### Database unavailable

Stop writes, determine whether the failure is transient or data-loss related,
and choose restart, immutable rollback, or empty-database restore. Follow the
disaster-recovery runbook for restoration and require new OAuth login afterward.

### Retention enforcement

Check the API retention completion/failure event and the last-attempt and
last-success metrics. A failed pass rolls back its entire transaction and must
be retried only after checking database availability and migration 0012. Never
manually broaden a deletion predicate to clear the alert. A stale pass beyond
two hours is treated as a scheduler or API-liveness fault.

### Private attachment deletion

Check `patchwork_attachment_deletion_failures_pending`, the redacted
`attachment_pipeline_sweep_completed` event, MinIO health, and the durable
`attachment_deletion_jobs` rows. Do not remove failed jobs or attachment
metadata to clear the alert. Restore object-store connectivity, allow the
bounded exponential retry to run, and verify that the original and derivative
keys are absent before resolving the incident. If the entire sweep failed,
check PostgreSQL, ClamAV, and MinIO readiness without copying object keys,
filenames, upload tokens, signed URLs, or attachment bodies into logs or
incident notes.

### Notification delivery

In-app intents remain durable while email or push delivery is unavailable.
Check the pending, retry, dead-letter, oldest-pending, and sweep-failure
metrics plus bounded error codes. Restore the configured provider or scheduler
and allow stable provider-idempotency keys to retry; do not recreate intents
or edit attempt counts manually. Invalid push subscriptions and bounced email
endpoints are disabled automatically. Never put email addresses, push
endpoints, subscription keys, notification bodies, exact locations, private
evidence, moderation notes, or provider credentials in incident notes.
Provider feedback uses its dedicated bearer-token boundary.

Every game day records UTC timestamps, commands, alert transition and delivery,
operator decision, recovery observation, and follow-up fixes in the Phase 7
evidence file. Local simulations do not satisfy the staging alert-delivery gate.


### 4.1 `error_rate_high` (P1 Critical)

**Condition**: HTTP 5xx error rate exceeds 5% over a 5-minute window.

**Triage steps**:

1. Check which service is emitting errors:
   ```promql
   rate(patchwork_sli_error_total{project="patchwork"}[5m])
   / rate(patchwork_sli_request_total{project="patchwork"}[5m])
   ```
2. Check application logs for the affected service for stack traces.
3. Check recent deployments -- was a new version rolled out in the last hour?
4. Check downstream dependencies (Postgres, AT Protocol relay).

**Mitigation**:

- If caused by a recent deploy: execute rollback (see rollback procedure in
  deployment docs).
- If caused by a downstream dependency: check dependency health; consider
  enabling circuit breaker or degraded mode.
- If caused by traffic spike: verify rate limiter is active; consider
  temporary traffic shedding.

**Escalation**: If not mitigated within 15 minutes, escalate to all
available engineering leads.

### 4.2 `latency_p95_high` (P2 Warning)

**Condition**: p95 response latency exceeds 2 seconds over a 5-minute window.

**Triage steps**:

1. Check API request duration:
   ```promql
   patchwork_sli_request_duration_seconds{service="api"}
   / patchwork_sli_request_total{service="api"}
   ```
2. Check Postgres query latency and connection pool usage.
3. Check for resource saturation (memory, CPU):
   ```promql
   patchwork_sli_saturation_ratio{service="api"}
   ```
4. Check for N+1 query patterns or missing indexes in recent code changes.

**Mitigation**:

- If caused by slow queries: identify and optimize; add missing indexes.
- If caused by resource exhaustion: scale horizontally or increase limits.
- If caused by a recent deploy: consider rollback.

### 4.3 `queue_depth_high` (P2 Warning)

**Condition**: Moderation queue pending depth exceeds 100 items.

**Triage steps**:

1. Check current queue depth and processing rate:
   ```promql
   moderation_queue_depth{service="moderation-worker"}
   ```
2. Check moderation worker logs for processing errors.
3. Check if the worker is running and healthy:
   ```promql
   patchwork_service_up{service="moderation-worker"}
   ```
4. Check for upstream spikes (spam wave, coordinated abuse).

**Mitigation**:

- If worker is down: restart the service.
- If worker is slow: check for blocking operations or resource constraints.
- If queue is flooded by spam: engage Trust & Safety for bulk action.
- Scale moderation workers if supported by deployment topology.

### 4.4 `checkpoint_stale` (P1 Critical)

**Condition**: Indexer checkpoint has not advanced in more than 5 minutes.

**Triage steps**:

1. Check checkpoint lag:
   ```promql
   patchwork_checkpoint_lag_seconds{service="indexer"}
   ```
2. Check indexer logs for errors in the ingestion pipeline.
3. Verify the AT Protocol firehose relay is reachable.
4. Check Postgres connectivity from the indexer.
5. Check checkpoint store health:
   ```promql
   patchwork_checkpoint_healthy{service="indexer"}
   ```

**Mitigation**:

- If the firehose connection dropped: restart the indexer (it resumes from
  the last checkpoint).
- If Postgres is unreachable: check database health and connectivity.
- If the checkpoint store is corrupted: restore from the last known good
  checkpoint (see disaster recovery runbook).

**Escalation**: If checkpoint does not advance within 10 minutes of
mitigation, escalate to ENG-IDX lead.

### 4.5 `disk_usage_high` (P2 Warning)

**Condition**: Disk usage exceeds 80% on the data volume.

**Triage steps**:

1. Identify which volume is approaching capacity.
2. Check Postgres WAL accumulation and table bloat.
3. Check log rotation -- are old logs being cleaned up?
4. Check for unexpected data growth patterns.

**Mitigation**:

- Run `VACUUM FULL` on bloated tables (schedule during low-traffic window).
- Clean up old WAL files if archiving is current.
- Expand the data volume (cloud provider resize).
- Review and enforce data retention policies.

### 4.6 `service_down` (P1 Critical)

**Condition**: Health check endpoint is failing for a service.

**Triage steps**:

1. Check which service is down:
   ```promql
   patchwork_service_up{project="patchwork"}
   ```
2. Attempt to reach the service health endpoint directly:
   ```bash
   curl -s http://<host>:<port>/health | jq .
   ```
3. Check container/process status.
4. Check system resources (OOM kills, disk full, network).
5. Check recent deployments.

**Mitigation**:

- If the process crashed: restart the service and check logs for the crash
  reason.
- If OOM killed: increase memory limits or investigate memory leaks.
- If network issue: check DNS, load balancer, and firewall rules.
- If caused by a recent deploy: execute rollback.

---

## 5. Post-Incident Review Template

Use this template within 48 hours (P1) or 1 week (P2) of incident resolution.

```markdown
# Post-Incident Review: <incident title>

**Date**: YYYY-MM-DD
**Severity**: P<N>
**Duration**: HH:MM (from detection to resolution)
**IC**: <name>
**Participants**: <list>

## Summary

<2-3 sentence summary of what happened and the user impact.>

## Timeline

| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert fired / issue reported |
| HH:MM | IC activated, incident channel opened |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Service restored |
| HH:MM | Incident resolved, monitoring confirmed |

## Root Cause

<Description of the underlying cause.>

## Impact

- **Users affected**: <number or percentage>
- **Duration of impact**: <time>
- **Data loss**: <none | description>
- **SLO budget consumed**: <percentage of error budget burned>

## What Went Well

- <item>
- <item>

## What Could Be Improved

- <item>
- <item>

## Action Items

| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| <description> | <name> | YYYY-MM-DD | Open |
| <description> | <name> | YYYY-MM-DD | Open |

## Lessons Learned

<Key takeaways for the team.>
```

---

## 6. Game Day Scenario Definitions

Game days are controlled exercises that simulate production incidents to
validate runbooks, tooling, and team readiness. See
the incident or exercise record attached to the relevant release for the exercise log template.

### Scenario 1: Service Outage -- API Down

**Objective**: Validate the `service_down` response procedure and IC activation.

**Setup**:
1. In a staging environment, stop the API service container.
2. Ensure monitoring is active and alerting is configured.

**Expected behavior**:
- `service_down` alert fires within 60 seconds.
- On-call engineer is paged within 5 minutes.
- IC is activated and opens an incident channel.
- API is restarted and health check returns 200 within the RTO target (< 1 hour).

**Success criteria**:
- Alert-to-acknowledgment time < 5 minutes.
- Alert-to-resolution time < 15 minutes.
- Communication templates used correctly.
- Post-incident review scheduled.

### Scenario 2: Data Corruption -- Checkpoint Store Failure

**Objective**: Validate the `checkpoint_stale` response and disaster recovery
restore procedure.

**Setup**:
1. In a staging environment, corrupt or remove the indexer checkpoint data
   in Postgres.
2. Allow the indexer to detect the stale checkpoint.

**Expected behavior**:
- `checkpoint_stale` alert fires within 5 minutes.
- Responder identifies the checkpoint store as unhealthy.
- Backup restore procedure is initiated (see [disaster-recovery.md](disaster-recovery.md)).
- Indexer resumes from the restored checkpoint.

**Success criteria**:
- Checkpoint restored from backup within RPO target (< 15 minutes of data loss).
- Full service recovery within RTO target (< 1 hour).
- Restore procedure matches documented steps.

### Scenario 3: Dependency Failure -- Database Unreachable

**Objective**: Validate response to a downstream dependency failure affecting
multiple services.

**Setup**:
1. In a staging environment, block network access to the Postgres instance
   (e.g., firewall rule or stop the Postgres container).
2. Allow all services to detect the failure.

**Expected behavior**:
- Multiple alerts fire: `service_down` (API readiness fails), `checkpoint_stale`
  (indexer cannot write checkpoints), `error_rate_high` (API 5xx spike).
- IC is activated and coordinates cross-service response.
- Services enter degraded mode where supported.
- After restoring Postgres, services recover automatically.

**Success criteria**:
- Grouped alert notifications are sent (noise reduction working).
- IC correctly identifies Postgres as the common root cause.
- All services recover within 5 minutes of Postgres restoration.
- No data loss beyond the RPO target.

---

*Created as part of Wave 3 reliability lane. Tracked by #105, #75, #68.*
