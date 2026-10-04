# Release lineage and acceptance baseline

Updated: 2026-10-04

This document is the current index for release lineage and readiness. It
reconciles the active Gitea repository with retained release evidence; it does
not turn historical evidence into a new live check.

## Repository lineage

- The intended integration and default branch is `main` in the canonical
  [Gitea repository](https://git.subcult.tv/subculture-collective/patchwork).
- `codex/chicago-public-resources` has independent history that must be
  preserved. It is not the default branch and is not evidence that its commits
  are integrated into `main`.
- Do not rewrite, delete, or silently merge either history. Any consolidation,
  branch retirement, or default-branch change requires a separate reviewed
  change with an explicit commit comparison and rollback plan.
- New work and issue references use the
  [Gitea issue tracker](https://git.subcult.tv/subculture-collective/patchwork/issues).
  Historical GitHub workflow names, paths, OIDC references, and issue numbers
  remain only where they identify retained implementation or evidence; they do
  not make GitHub the current planning authority.

## Status vocabulary

Readiness claims use these terms separately:

- **Implemented:** a source path exists on `main`.
- **Verified:** repository or controlled integration checks exercised that
  path. The applicable evidence and its date must be cited.
- **Deployed:** an identified immutable release ran in a named environment.
- **Qualified:** all acceptance gates for the stated pilot or launch boundary
  have current evidence and required owner approvals.
- **Deferred:** the behavior is outside the current acceptance boundary and
  must not be presented as a runtime capability.

The [current-state matrix](../architecture/current-state-matrix.md) is the
implementation inventory. The retained September 20 release-candidate records
and other dated records remain historical evidence only; they are not a fresh
deployment, qualification, link, or capacity check.

## Current acceptance

Patchwork is implemented as a responsive-web pre-alpha demonstration but is
not qualified for pilot participants or public launch. The controlling
decision remains **NO-GO**. Feature completion, local tests, home-staging
deployment, and historical release evidence do not independently authorize a
pilot or launch.

Reconsideration requires a fresh, release-bound review that:

1. identifies the exact `main` commit and immutable deployed artifacts;
2. passes the repository, migration, readiness, credentialed browser/PDS,
   rollback, recovery, retention, and clean-window capacity gates applicable
   to that release;
3. records independent security, privacy, accessibility, and translation
   reviews with no unresolved launch blocker;
4. demonstrates independent backup replication and live provider exercises;
5. names accepted product, engineering, infrastructure, privacy, and
   trust-and-safety owners, plus distinct primary and secondary operational
   coverage and a human alert-acknowledgment exercise; and
6. records an explicit `GO`, `CONDITIONAL GO`, or `NO-GO`, with an owner and
   expiry for every condition or exception.

The detailed retained decision and gate definitions are in the
[alpha go/no-go review](evidence/phase-8/alpha-go-no-go.md). Expired dates in
that record do not lower a gate; they require fresh evidence and a new review.

## Unresolved requirements and owner decisions

The following remain open unless a newer, reviewed Gitea record explicitly
closes them:

| Requirement | Required owner or evidence |
| --- | --- |
| Current credentialed OAuth/PDS and notification-provider journeys | Engineering and infrastructure |
| Current Gitea-hosted immutable promotion evidence | Infrastructure and an independent reviewer |
| Independent backup replication and restore evidence | Infrastructure and privacy |
| Formal retention, backup-deletion, suppression-marker, and AT-repository-boundary approval | Privacy and engineering |
| Independent security and privacy review | Security, privacy, and product |
| Independent WCAG 2.2/assistive-technology review | Accessibility and product |
| Professional translation review | Product and an accepted language reviewer |
| Clean-window mixed capacity rerun and production sizing approval | Engineering and infrastructure |
| Distinct secondary coverage and human alert acknowledgment | Product, infrastructure, and incident command |
| Accepted pilot scope and final launch decision | Product, engineering, infrastructure, privacy, and trust-and-safety |

Native mobile, offline/PWA synchronization, multi-region tenancy, reputation,
and external connectors remain deferred expansion work. Advanced routing is an
implemented but unqualified application capability until its activation,
application-level journey, and observation gates pass. None of these items may
be inferred complete from historical plans, source presence, local tests, or
router-only evidence.

Private coordination, independent review, user-owned AT record provenance, and
the transient browser-to-browser exact-person-location boundary remain
mandatory acceptance constraints. No owner may waive them implicitly.
