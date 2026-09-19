# Patchwork alpha go/no-go review

Decision date: 2026-07-28 (America/Chicago)

Decision: **NO-GO**

Next review: **not scheduled**. A new review requires current evidence for every
hard gate below.

Patchwork must not accept pilot participants or public traffic. The local alpha
implementation is materially stronger than the abandoned prototype. Phase 6
and the Phase 7 technical home-staging gate are now demonstrated, but the
human-review and pilot-authority gates are not. There are no exceptions to the
launch criteria in this decision.

## Feature-completion addendum — 2026-07-29

The buyer-ready web feature program completed its clean repository acceptance
at revision `6025cb2d`. This changes the software feature assessment, not the
launch decision. Every charter-included subsystem now has a durable or
externally integrated runtime path, the browser gate runs against the built
production bundle, and the feature-completion review is recorded in
[`buyer-ready-phase-9-feature-completion-2026-07-29.md`](../buyer-ready-phase-9-feature-completion-2026-07-29.md).

The independent and human-authority gates below were not supplied. The
decision remains **NO-GO**, public deployment and participant recruitment
remain prohibited, and no feature-completion result is launch approval.

## Product-gap sprint addendum — 2026-08-04

The post-roadmap sprint closed OAuth callback restoration, misleading deferred
navigation, reversible map-area interactions, and durable outcome-safety
escalation. A fresh zero-state database and production-bundle browser gate are
recorded in
[`buyer-ready-product-gap-sprint-2026-08-04.md`](../buyer-ready-product-gap-sprint-2026-08-04.md).
The dependency audit also identified and resolved a current Undici advisory
before acceptance was repeated. These results strengthen the software
assessment but do not satisfy the independent or human-authority gates. The
decision remains **NO-GO**.

## Protected-pilot readiness addendum — 2026-08-07

The protected-pilot sprint completed every executable local and home-staging
control at revision `768f9ca5`. Eight detailed user stories and forty atomic
acceptance criteria now map to executable tests. The full repository gate,
fresh PostgreSQL integration suites, real MinIO/clamd integration, production
build, 147-case production-bundle Chromium run, dependency audits, image
scans, deploy-host trust verification, immutable deployment, checksummed
rollback, forward recovery, live backup/empty-target restore, and the bounded
post-deploy stability soak passed. A fresh attempt to re-certify the earlier
40-RPS home-staging point failed during severe shared-host contention and is
not promoted into launch evidence. Twenty Patchwork alert rules are loaded.
The release-bound record is
[`protected-pilot-readiness-2026-08-07.md`](../protected-pilot-readiness-2026-08-07.md).

Each deployed image has a verified local-key signature plus SPDX SBOM and SLSA
provenance attestations. This improves the home-staging boundary, but it is not
equivalent to the protected GHCR/OIDC path because the private registry and
signing key are local and transparency-log verification is unavailable.

Patrick Fanella is the accepted home-staging primary on-call, escalation owner,
and default incident commander. No distinct secondary accepted coverage, so a
human acknowledgment/escalation game day cannot truthfully be completed.
Credentialed live PDS and notification-provider exercises, a live independent
S3 backup replication, independent security/privacy/accessibility/translation
reviews, and production capacity approval also remain unavailable. The current
decision is therefore **NO-GO**: public traffic and participant recruitment
remain prohibited.

## Jetstream v2 cutover addendum — 2026-08-15

`caaef1e` promoted the indexer from Jetstream v1 to v2. Production and staging
Compose defaults now use `INDEXER_JETSTREAM_VERSION=v2` and
`INDEXER_PROJECTION_MODE=v2-live`. The v1 projection and checkpoint remain in
rollback storage. The repository includes v2 source, backfill, shadow-store,
comparison, and cutover tests.

No protected-staging v2 replay, projection comparison, disconnect drill, or
credentialed PDS lifecycle run is recorded. The cutover changes the source
code's ingestion path. It does not satisfy any launch gate. The decision remains
**NO-GO**.

## Evidence reviewed

| Area | Current evidence | Assessment |
| --- | --- | --- |
| AT record lifecycle | Phase 2 direct-PDS evidence plus the 2026-07-28 controlled two-account browser journey | Complete home-network OAuth/API/PDS/Jetstream/browser path proven |
| Durable private state | Phase 3 restart, concurrency, idempotency, audit, and moderation evidence | Local and PostgreSQL gates pass |
| HTTP security | Phase 4 method, auth, CSRF, stable-error, idempotency, and privacy evidence | Local gate passes |
| Live ingestion and discovery | Phase 5 cursor, reconnect, projection, tombstone, dead-letter, rebuild, query, and automatic lifecycle-reconciliation evidence plus controlled live aid and directory lifecycles | Home-network external gate passes; protected staging repetition remains |
| Web journey | The 2026-08-07 clean gate builds and serves the production bundle and passes 147 runnable Chromium cases; one credentialed live OAuth/PDS case is skipped locally. Earlier controlled two-account OAuth cases passed before and after prior immutable deployments. | Buyer-ready local feature gate and prior controlled external OAuth path pass; fresh credentialed callback/signup/PDS repetition remains external |
| Staging topology and delivery | Revision `768f9ca5` is the current four-image exact-digest release. Its images parse to zero HIGH/CRITICAL findings, verify with the retained local key and both required attestations, replay 25/6/5 migrations cleanly, and pass readiness and content-addressed map checks. The checksummed rollback to `d791fb01` and forward promotion both succeeded. | Technical home-staging gate satisfied; protected GHCR/OIDC execution remains absent |
| Recovery and alerting | NUC indexer-disconnect alert/recovery plus a 2026-08-07 live PostgreSQL 17 backup and three-second empty-target restore with measured RTO/RPO; twenty rules are loaded | Local mechanisms pass; credentialed independent replication and human acknowledgment remain |
| Security | Both dependency audits are green; Trivy 0.59.1 reports zero HIGH/CRITICAL findings for all four deployed images; Cosign verifies every digest plus SPDX SBOM and SLSA provenance attestations | Home-staging image gate green; signing key and registry share the host and have no transparency-log record |
| Data retention | API migration 0012 and moderation migration 003 drive hourly non-overlapping cleanup for all alpha-private state. Active moderation cases and sessions are preserved; failure/staleness metrics alert for both runtimes. The immutable NUC schedulers removed representative expired API and moderation rows on their next natural hourly pass with successful metrics, zero alerts, and zero restarts. | Formal privacy/backup-deletion, retained-exception, suppression-marker, and AT-repository-boundary approval remains incomplete |
| Data subject access and deactivation | Authenticated versioned export covers Patchwork-held alpha data without credentials or cross-subject projections. Durable deactivation removes Patchwork state, revokes login, sanitizes bounded retained exceptions, and suppresses future commands/projections. Six disposable workload users passed the real staging deactivation path and aggregate cleanup verification. | Independent AT-repository deletion, controlled human casework review, and formal privacy approval remain incomplete |
| Accessibility | The production-bundle Chromium gate passes 147 runnable cases, including zero-violation axe route scans, cross-route 320px reflow, 200% text sizing, reduced-motion, keyboard, focus, and localization checks | No independent WCAG 2.2 or assistive-technology review |
| Buyer-ready runtime | Organizations/stewardship, verification/exact public addresses, offers/connections/outcomes, matching, private attachments, exact peer location, notifications, moderation/maintenance, showcase origin, export/deactivation, and the no-chat boundary pass clean local gates | Feature-complete locally; protected providers, independent reviews, and launch operations remain unapproved |
| Performance | The earlier mixed immutable-staging run proved 40 aggregate RPS. On 2026-08-07, a fresh direct 40-RPS read run failed while shared-host load reached 19–29 and swap was exhausted; Patchwork remained healthy at zero restarts. A separate five-minute 8-RPS stability soak completed 2,400 reads with zero errors and 213.556 ms worst p95 despite recurring contention. | Stability is current, but the prior 40-RPS point is not re-certified for this release; a clean-window mixed rerun and production sizing remain required |
| Operations | Role-based RACI and incident procedures exist; Patrick Fanella accepted home-staging primary on-call, escalation, and default incident-command ownership | No distinct secondary, staffed rotation, human acknowledgment drill, or accepted product/privacy/trust-and-safety review ownership |

Current verification baseline:

- repository unit/contract suite: web 256, API 321 runnable, indexer 35
  runnable, moderation 53 runnable, AT client 26, lexicons 5, and shared 321;
- fresh PostgreSQL suites: API 77, indexer 52, and moderation 71;
- direct web service integration: 8 tests;
- real MinIO/clamd attachment integration: 1 end-to-end case;
- production-bundle Chromium: 147 runnable cases passed and 1
  credential-required external PDS case skipped;
- diagnostic coverage: 42.95% statements, 33.72% branches, 38.00% functions,
  and 44.13% lines across 1,017 runnable tests;
- API/indexer/moderation migrations replay cleanly at 25/6/5;
- build, typecheck, lint, exact-location absence, artifact redaction,
  Prometheus rule validation, and production/full dependency audits pass.

These local results are necessary but do not substitute for external proof.

## Hard conditions for reconsideration

| Condition | Required proof | Accountable role | Due or expiry |
| --- | --- | --- | --- |
| `AT-BROWSER` | Satisfied 2026-07-28: two disposable users completed OAuth, create, ingest, discover, report, block, close, and delete with no fixture fallback | Engineering | Complete |
| `IMMUTABLE-STAGING` | Satisfied for NUC home staging 2026-07-28: four scanned and signed digests deployed without rebuild and passed deep readiness/browser acceptance. Protected GHCR/OIDC promotion remains a production hardening item. | Infrastructure | Complete for home staging |
| `ROLLBACK` | Satisfied 2026-07-28: staging returned to a signed prior-source four-digest manifest without a down migration, passed readiness, and promoted forward again | Infrastructure | Complete |
| `RECOVERY` | Satisfied 2026-07-28: a live staging backup restored into an empty database, invalidated sessions, preserved required state, and recorded 1-second RTO/22-second RPO | Infrastructure + Engineering | Complete |
| `ALERT-GAMEDAY` | Mechanism satisfied 2026-07-28: indexer disconnect fired through Alertmanager and recovered; human acknowledgment remains part of `OWNERSHIP` | Infrastructure + Incident Commander | Complete |
| `RETENTION` | Scheduled private-data expiry and deactivation are implemented and tested; backup, retained-exception, suppression-marker, and AT-repository-boundary policy is formally approved | Privacy + Engineering | 2026-08-11 |
| `ACCESSIBILITY` | Independent WCAG/assistive-technology review has no unresolved launch-blocking finding | Accessibility + Product | 2026-08-11 |
| `CAPACITY` | The 2026-07-28 mixed run established a 40-RPS home-staging point. The 2026-08-07 re-certification attempt failed under measured unrelated host contention; only an 8-RPS zero-error stability soak is current. Repeat the mixed 40-RPS gate in a clean resource window and retain production sizing as a separate authority gate. | Engineering + Infrastructure | Before reconsideration |
| `OWNERSHIP` | Patrick Fanella accepted home-staging primary on-call, escalation, and default incident-command ownership. A distinct secondary plus accepted product, engineering, infrastructure, privacy, and trust-and-safety review ownership remain required. | Product | Before reconsideration |

Any condition not completed by its date expires the review; it does not become
an implicit exception. A fresh go/no-go review must collect current evidence.

## Decision consequence

Keep all public deployment and recruitment disabled. Complete safe local work
and the authorized staging gates, then reassess. Do not begin an expansion
feature or pilot under this decision. If the organization cannot assign owners
and execute the staging gates, use the project-closure path instead of leaving
an ambiguous dormant service.
