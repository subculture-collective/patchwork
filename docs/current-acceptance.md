# Current delivery and acceptance contract

This document separates implementation from release evidence. The [ordered
roadmap](https://github.com/subculture-collective/patchwork/issues/160)
is the work index; [design-system.md](./design-system.md) defines user journeys
and [quality-gates.md](./quality-gates.md) defines executable checks.

## Integration and review

Gitea is the review and CI origin. `main` is the integration and promotion
branch. New work starts from current `main`; stacked PRs target their immediate
parent branch, so each review contains one implementation unit. Merge the stack
in dependency order, retargeting children as appropriate. Creating a PR does not
merge, deploy or close its issue. Include exact checks and unresolved acceptance
items in each description.

The former `codex/chicago-public-resources` integration lineage was merged into
`main` without rewriting either history (release work
[#21](https://github.com/subculture-collective/patchwork/issues/171)). Keep
that branch unchanged as history; do not start new work from it. Do not
interpret any branch name as the deployed revision; the release record and
retained deployment readback identify what is running.

## Implemented baseline and remaining evidence

This is a contract inventory, not a new live health check or test-count ledger.
The merged source/travel tranche includes publisher evidence and review,
libraries excluded by default, daily source orchestration, Chicago routing and
weekly graph maintenance. The earlier large-bundle warning was removed. PRs
[6](https://git.subcult.tv/subculture-collective/patchwork/pulls/6),
[7](https://git.subcult.tv/subculture-collective/patchwork/pulls/7),
[8](https://git.subcult.tv/subculture-collective/patchwork/pulls/8) and
[9](https://git.subcult.tv/subculture-collective/patchwork/pulls/9) retain the
implementation and historical validation context. Operational records must be
matched to the release being assessed before reuse.

| Boundary | Implemented behavior | Required remaining acceptance |
| --- | --- | --- |
| Source refresh | Raw evidence, normalized validation, persistent candidates, guarded contact application and scheduled runner | Natural timer evidence [#12](https://github.com/subculture-collective/patchwork/issues/162); current independent queue decisions [#16](https://github.com/subculture-collective/patchwork/issues/166) |
| Useful service data | Versioned profiles, evidence expiry/conflict handling and private in-memory eligibility answers | Authoritative non-library Chicago schedules and eligibility with agreed useful coverage [#38](https://github.com/subculture-collective/patchwork/issues/188); location counts and CPL display hours do not qualify this |
| Travel | Chicago self-hosted OTP, transient-origin UI/API, timeout/cancellation and bounded concurrency | Natural graph refresh and sustained observation [#13](https://github.com/subculture-collective/patchwork/issues/163); consented physical-device journey [#14](https://github.com/subculture-collective/patchwork/issues/164) |
| Core coordination | Public AT commands/projections, private requests/offers/connections, scheduling, groups and bounded chat | Disposable real-provider and two-account lifecycle, notification and recovery evidence [#15](https://github.com/subculture-collective/patchwork/issues/165) |
| Release trust | Scanned/signed immutable images, provenance and guarded deployment/rollback mechanisms | Reproducible Gitea promotion on intended lineage [#21](https://github.com/subculture-collective/patchwork/issues/171); fixtures or PR creation do not prove deployment |
| Recovery | Logical backups and independent replication/restore mechanisms | Current-release independent database/object/evidence restore and measured RPO/RTO [#17](https://github.com/subculture-collective/patchwork/issues/167) |
| Operations | Monitoring rules/runbooks; Patrick Fanella is the named responder | Actual alert delivery, human acknowledgment and recovery [#18](https://github.com/subculture-collective/patchwork/issues/168) |
| Trust and usability | Authorization, moderation, privacy, translation and accessibility mechanisms/checks | Required independent security/privacy/accessibility/language reviews [#19](https://github.com/subculture-collective/patchwork/issues/169) |
| Capacity | Executable probes and historical bounded staging measurements | Current representative directory/routing/refresh envelope and browser budgets [#20](https://github.com/subculture-collective/patchwork/issues/170) |

Tests, hosted CI, signed artifacts, deployed identity, live service health,
natural scheduled execution, real providers and human review are separate
evidence tiers. A manual run cannot establish a natural timer firing. A new
download cannot renew unchanged provider confirmation. Never fabricate missed
observation intervals or count skipped provider suites as passed.

## Unresolved historical requirements

The following conflicts need explicit evidence or owner decisions. This document
does not waive them or infer launch approval from an already accessible site.

- The six-hour logical-backup cadence does not establish the documented
  sub-15-minute RPO. Issue #17 must settle the required recovery objective;
  [#75](https://github.com/subculture-collective/patchwork/issues/225) is the
  PITR/equivalent implementation path if tighter recovery remains required.
- Patrick's primary-responder assignment does not satisfy the older independent
  secondary/escalation model. Issue #18 records the pilot's coverage decision
  and drills; no second responder is assumed.
- Historical game-day documents require disabled public traffic/recruitment.
  Define the protected exercise environment and launch scope explicitly before
  applying those procedures to an existing public deployment.
- The GHCR/OIDC procedure is a separate trust path from the scoped-key,
  digest-pinned home-host release. Issue #21 reconciles operational instructions
  with Gitea; neither path's evidence proves the other.
- Historical `NO-GO` language remains an unresolved acceptance boundary until
  [pilot review #22](https://github.com/subculture-collective/patchwork/issues/172)
  makes an explicit scoped decision. No general public-launch approval is
  established by this documentation change.

## Deferred and optional scope

Native client files and offline-sync primitives are scaffolding/design inputs,
not device or offline-delivery qualification. Track native implementation/release
in [#60](https://github.com/subculture-collective/patchwork/issues/210) and
[#61](https://github.com/subculture-collective/patchwork/issues/211), read-only
offline packs in [#58](https://github.com/subculture-collective/patchwork/issues/208),
and offline writes in [#59](https://github.com/subculture-collective/patchwork/issues/209).
Partner exchange, Canada/Mexico, expanded travel, reputation, multi-region
topology and full firehose ingestion retain their roadmap dependencies and
decision gates. These do not all block the current bounded pilot.

Public request publication remains ZIP-only for new records. Precise personal
coordinates are never persistent state. The transient travel exception and
private peer-exchange consent are distinct from publishing eligible public
resource addresses. The existence of a schema or an imported location never
grants ownership, verifies eligibility or authorizes a confidential-address
disclosure.
