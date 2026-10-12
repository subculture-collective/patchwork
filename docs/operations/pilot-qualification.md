# Pilot qualification

[Milestone 56](https://git.subcult.tv/subculture-collective/patchwork/milestone/56)
closes only after its required gates pass and
[issue #22](https://git.subcult.tv/subculture-collective/patchwork/issues/22)
records the accepted readiness decision. Use the
[release baseline](release-baseline.md) for the acceptance contract. Completing
an engineering session or passing CI does not accept an operational gate.

## Bind evidence to the release

Before provider journeys, recovery qualification, or capacity measurements:

1. Select the exact canonical `main` commit and successful Gitea CI run.
2. Record all four running image digests and OCI source revisions, migration
   state, graph/input hashes, and applicable configuration identity in the
   private release record. Reconcile component revisions before calling the
   stack one release; use an explicit reviewed manifest for any intended mix.
3. Verify scans, signatures, SBOM, provenance, readiness, and the retained
   rollback baseline through the guarded staging release path.
4. Link retained evidence from each issue. Reuse evidence only when its release,
   scenario, and acceptance boundary match. Keep operational artifacts outside
   Git and redact credentials, private account data, and personal origins.

Natural scheduler results may qualify their deployed component separately.
Retain its exact image/revision and command identity; do not relabel an older
component's observation as proof for a newly promoted release.

## Required work

| Gate | Evidence needed for acceptance | Next action |
| --- | --- | --- |
| [#12 Source refresh](https://git.subcult.tv/subculture-collective/patchwork/issues/12) | Natural attempt, publisher hash, heartbeat, replay safety, failure/staleness monitoring | Read timer/journal, retained manifest/raw bytes, database aggregates, and loaded Prometheus rules; preserve library exclusion and review-only application |
| [#13 Routing maintenance](https://git.subcult.tv/subculture-collective/patchwork/issues/13) | Natural refresh, feed/graph identity, itinerary validation, activation/recovery, sustained metrics | Agree the observation interval before collecting it; retain the last good graph and exercise failure in isolation |
| [#14 Physical-device travel](https://git.subcult.tv/subculture-collective/patchwork/issues/14) | Consented location-to-itinerary journey, denial/cancel/retry, coverage and wheelchair wording, transient-origin proof | Name the physical device/browser and obtain explicit location consent; retain only redacted evidence |
| [#15 Real providers](https://git.subcult.tv/subculture-collective/patchwork/issues/15) | Both credentialed suites, durable two-account coordination, mail/push delivery and cleanup | Provide disposable identities and opt-in destinations through private configuration; enumerate remaining skips |
| [#16 Publisher review](https://git.subcult.tv/subculture-collective/patchwork/issues/16) | Every live candidate has an independent reasoned decision or owned follow-up; stale decisions refused | Recount first, inspect source and current revisions, then decide through reviewer APIs; preserve imports and newer provider edits |
| [#17 Recovery](https://git.subcult.tv/subculture-collective/patchwork/issues/17) | Independent checksummed database and private-object restore, invariants, session invalidation, measured RPO/RTO | Confirm destination ownership/retention; restore into disposable targets and resolve the six-hour backup versus sub-15-minute RPO contract explicitly |
| [#18 Incident response](https://git.subcult.tv/subculture-collective/patchwork/issues/18) | Representative deployed alert delivery, human acknowledgment, safe maintenance and recovery | Name the responder/observer, record the secondary-coverage decision, and agree the bounded game-day scope |
| [#19 Independent reviews](https://git.subcult.tv/subculture-collective/patchwork/issues/19) | Security/privacy, assistive technology, English/Spanish critical flows, policy consistency, findings disposition | Assign qualified independent reviewers using the review register; fix required blockers and retain reviewer acceptance |
| [#20 Capacity](https://git.subcult.tv/subculture-collective/patchwork/issues/20) | Named-release national/travel mixed workload, p95/p99/errors, browser cost, headroom and recovery | Use an isolated or agreed controlled target; compare original budgets and establish the measured envelope |
| [#21 Release](https://git.subcult.tv/subculture-collective/patchwork/issues/21) | Exact-source Gitea CI, immutable trusted artifacts, refusal/rollback exercises, coherent release record | Use guarded promotion after reconciling current component revisions; retain independent review and provider evidence |
| [#38 Non-library service coverage](https://git.subcult.tv/subculture-collective/patchwork/issues/38) | Agreed useful category/geography coverage, reviewed hours/eligibility, current/conflicting/expired browser journeys | Resolve #24/#28/#30/#31 prerequisites; agree minimum coverage before collecting assertions |
| [#22 Pilot exit](https://git.subcult.tv/subculture-collective/patchwork/issues/22) | Complete gate-to-evidence map, useful non-library coverage, owner decision and response/rollback capability | Review every gate above; do not record GO with required gates open |

Issue #38 belongs to milestone 58 but remains a hard prerequisite of #22.
Total directory locations and CPL display-hours text do not satisfy it.

## Operator and independent-review inputs

Engineering can inspect natural runs, prepare the candidate release and
review packets, run isolated refusal/recovery checks, and repair defects.
The following require explicit input before their dependent work proceeds:

- Physical-device location consent and disposable provider identities/destinations.
- The routing observation interval and useful non-library category/geography
  coverage threshold.
- Independent reviewer assignments and acceptance, responder availability,
  and the decision on secondary coverage.
- Independent backup destination control/retention and the RPO contract decision.

Use the [independent-review register](reviews/protected-pilot-review-register.md)
and [game-day record](protected-pilot-game-day.md) for those decisions. An
implementation agent's review cannot supply independent acceptance of its
own work. Do not send drill alerts until the bounded exercise and notification
are explicitly authorized.

## Record the decision

In #22, identify the release, link each accepted gate and any remaining condition,
name the decision owner, and record rollback/response capability and limitations.
Keep the milestone open while a required gate remains unaccepted. Dates become
commitments only when agreed; elapsed time does not provide consent or approval.
