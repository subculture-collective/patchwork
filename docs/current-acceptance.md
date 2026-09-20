# Current delivery and acceptance contract

This document separates implementation from release evidence. The [ordered
Gitea roadmap](https://git.subcult.tv/subculture-collective/patchwork/issues/10)
is the work index; [design-system.md](./design-system.md) defines user journeys
and [quality-gates.md](./quality-gates.md) defines executable checks.

## Integration and review

Gitea is the review and CI origin. New work starts from
`codex/chicago-public-resources`. Subsequent stacked PRs target their immediate
parent branch, so each review contains one implementation unit. Merge the stack
in dependency order, retargeting children as appropriate. Creating a PR does not
merge, deploy or close its issue. Include exact checks and unresolved acceptance
items in each description.

The repository default branch is still `main`. Preserve both histories; any
consolidation or default-branch change belongs to [release work
#21](https://git.subcult.tv/subculture-collective/patchwork/issues/21). Do not
interpret the default branch as the deployed revision or rewrite history to make
the names agree.

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
| Source refresh | Raw evidence, normalized validation, persistent candidates, guarded contact application and scheduled runner | Natural timer evidence [#12](https://git.subcult.tv/subculture-collective/patchwork/issues/12); current independent queue decisions [#16](https://git.subcult.tv/subculture-collective/patchwork/issues/16) |
| Useful service data | Versioned profiles, evidence expiry/conflict handling and private in-memory eligibility answers | Authoritative non-library Chicago schedules and eligibility with agreed useful coverage [#38](https://git.subcult.tv/subculture-collective/patchwork/issues/38); location counts and CPL display hours do not qualify this |
| Travel | Chicago self-hosted OTP, transient-origin UI/API, timeout/cancellation and bounded concurrency | Natural graph refresh and sustained observation [#13](https://git.subcult.tv/subculture-collective/patchwork/issues/13); consented physical-device journey [#14](https://git.subcult.tv/subculture-collective/patchwork/issues/14) |
| Core coordination | Public AT commands/projections, private requests/offers/connections, scheduling, groups and bounded chat | Disposable real-provider and two-account lifecycle, notification and recovery evidence [#15](https://git.subcult.tv/subculture-collective/patchwork/issues/15) |
| Release trust | Scanned/signed immutable images, provenance and guarded deployment/rollback mechanisms | Reproducible Gitea promotion on intended lineage [#21](https://git.subcult.tv/subculture-collective/patchwork/issues/21); fixtures or PR creation do not prove deployment |
| Recovery | Logical backups and independent replication/restore mechanisms | Current-release independent database/object/evidence restore and measured RPO/RTO [#17](https://git.subcult.tv/subculture-collective/patchwork/issues/17) |
| Operations | Monitoring rules/runbooks; Patrick Fanella is the named responder | Actual alert delivery, human acknowledgment and recovery [#18](https://git.subcult.tv/subculture-collective/patchwork/issues/18) |
| Trust and usability | Authorization, moderation, privacy, translation and accessibility mechanisms/checks | Required independent security/privacy/accessibility/language reviews [#19](https://git.subcult.tv/subculture-collective/patchwork/issues/19) |
| Capacity | Executable probes and historical bounded staging measurements | Current representative directory/routing/refresh envelope and browser budgets [#20](https://git.subcult.tv/subculture-collective/patchwork/issues/20) |

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
  [#75](https://git.subcult.tv/subculture-collective/patchwork/issues/75) is the
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
  [pilot review #22](https://git.subcult.tv/subculture-collective/patchwork/issues/22)
  makes an explicit scoped decision. No general public-launch approval is
  established by this documentation change.

## Deferred and optional scope

Native client files and offline-sync primitives are scaffolding/design inputs,
not device or offline-delivery qualification. Track native implementation/release
in [#60](https://git.subcult.tv/subculture-collective/patchwork/issues/60) and
[#61](https://git.subcult.tv/subculture-collective/patchwork/issues/61), read-only
offline packs in [#58](https://git.subcult.tv/subculture-collective/patchwork/issues/58),
and offline writes in [#59](https://git.subcult.tv/subculture-collective/patchwork/issues/59).
Partner exchange, Canada/Mexico, expanded travel, reputation, multi-region
topology and full firehose ingestion retain their roadmap dependencies and
decision gates. These do not all block the current bounded pilot.

Public request publication remains ZIP-only for new records. Precise personal
coordinates are never persistent state. The transient travel exception and
private peer-exchange consent are distinct from publishing eligible public
resource addresses. The existence of a schema or an imported location never
grants ownership, verifies eligibility or authorizes a confidential-address
disclosure.
