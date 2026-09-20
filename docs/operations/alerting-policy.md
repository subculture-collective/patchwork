# Alerting policy

Patchwork's executable staging rules are
[`monitoring/prometheus/patchwork-alerts.yml`](../../monitoring/prometheus/patchwork-alerts.yml).
They are validated with `promtool check rules`; notification delivery and alert
transitions must still be demonstrated on the authorized staging stack.
Patrick Fanella is the named interim home-staging primary on-call and
escalation owner. Every executable rule carries
`owner="patchwork-primary-on-call"`; this alias resolves to Patrick in the
staging ownership record while contact routing remains environment-private. A
distinct secondary responder and a measured human acknowledgment drill remain
open.

| Alert | Severity | Condition | Response |
| --- | --- | --- | --- |
| `PatchworkApiErrorRateHigh` | critical | API 5xx ratio above 5% for 5 minutes | Page within 5 minutes |
| `PatchworkIndexerDisconnected` | critical | AT source disconnected for 2 minutes | Page within 5 minutes |
| `PatchworkIndexerLagHigh` | critical | AT delivery lag above 5 minutes for 5 minutes | Page within 5 minutes |
| `PatchworkModerationQueueOldestItemHigh` | warning | oldest queued case above 15 minutes for 5 minutes | Respond within 15 minutes |
| `PatchworkUrgentModerationNotificationPending` | critical | urgent moderator notification remains unconsumed for 5 minutes | Page within 5 minutes |
| `PatchworkMaintenanceModeActive` | warning | safety maintenance remains active for 5 minutes | Confirm incident ownership within 15 minutes |
| `PatchworkDatabaseUnavailable` | critical | PostgreSQL scrape target down for 1 minute | Page within 5 minutes |
| `PatchworkSourceRefreshFailed` | warning | latest scheduled CPL refresh failed | Respond within 15 minutes |
| `PatchworkSourceRefreshStale` | warning | no completed CPL refresh for 36 hours | Respond within 15 minutes |
| `PatchworkRoutingUnavailable` | warning | OTP metrics target down for 5 minutes | Respond within 15 minutes |
| `PatchworkTravelRouteErrors` | warning | more than two travel API errors in 15 minutes | Respond within 15 minutes |
| `PatchworkBackupFailed` | warning | most recent backup attempt failed | Respond within 15 minutes |
| `PatchworkBackupStale` | warning | no successful backup for 7.5 hours | Respond within 15 minutes |
| `PatchworkIndependentBackupFailed` | warning | database/private-object replication failed | Respond within 15 minutes |
| `PatchworkIndependentBackupStale` | warning | no independent snapshot for 7.5 hours | Respond within 15 minutes |
| `PatchworkRetentionFailed` | warning | latest API retention pass failed for 5 minutes | Respond within 15 minutes |
| `PatchworkRetentionStale` | warning | no successful API retention pass for 2 hours | Respond within 15 minutes |
| `PatchworkAttachmentDeletionFailed` | warning | one or more private-object deletion jobs are pending after failure | Respond within 15 minutes |
| `PatchworkAttachmentPipelineSweepFailed` | warning | an attachment pipeline sweep failed during the last 15 minutes | Respond within 15 minutes |
| `PatchworkNotificationDeadLetter` | warning | one or more notification deliveries reached dead-letter state | Respond within 15 minutes |
| `PatchworkNotificationDeliveryStale` | warning | the oldest pending notification delivery exceeds 15 minutes | Respond within 15 minutes |
| `PatchworkNotificationSweepFailed` | warning | a notification delivery sweep failed during the last 15 minutes | Respond within 15 minutes |
| `PatchworkModerationRetentionFailed` | warning | latest moderation retention pass failed for 5 minutes | Respond within 15 minutes |
| `PatchworkModerationRetentionStale` | warning | no successful moderation retention pass for 2 hours | Respond within 15 minutes |

The API records completed requests and 5xx responses in the shared SLI
counters. The indexer exports source connection and lag gauges. Moderation
calculates depth and oldest-item age from its durable queue at scrape time.
The backup script atomically writes Prometheus textfile metrics and preserves
the previous success timestamp after a failed attempt. PostgreSQL availability
uses Prometheus target health (`up`) from the `patchwork-postgres` scrape job.

Alerts auto-resolve only after their expression is healthy. Planned maintenance
may silence warnings, but not critical data-loss or outage alerts. Every alert
must retain its `runbook_url` annotation. A staging game day must prove routing,
receipt, acknowledgement, and resolution before Phase 7 can close.
