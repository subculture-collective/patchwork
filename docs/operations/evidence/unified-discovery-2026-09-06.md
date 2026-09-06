# Unified discovery and request context — 2026-09-06

The user requested one map/filter/list page, reliable location state, compact collapsible
filters, zoom-responsive clusters, and a more useful request detail page.

## Delivered behavior

- `/nearby`, `/map`, and `/feed` resolve to the same map/filter/list experience. Legacy
  view parameters normalize away; filter and selection links retain browser history.
- Location belongs to the shell, so navigation does not restart its status. Requests use
  a 15-second timeout, distinguish permission/device/timeout failures, and retry explicitly.
  A failed initial lookup selects Chicagoland; a failed refresh preserves the selected area.
  Clearing an area cancels pending location callbacks and keeps the existing map mounted.
- Clearing the area loads all-area requests and directory resources. The map camera remains
  separate from the query area, and Search this area changes the results explicitly.
- Filters collapse below the map, with 32px compact buttons and two columns from 640px.
- Request aggregate cells use the existing public approximate coordinates with 0.01-degree
  cells and retain their precision envelope. Screen-space clustering recalculates at each
  zoom. Clicking a cluster zooms one level and dims unrelated requests/resources; zooming out
  merges clusters. Keyboard activation and reduced-motion preferences are supported.
  Records sharing the same approximate cell remain grouped; no precise addresses are invented.
- Request details show category, urgency, status, description, approximate area and links,
  posted/updated dates, sharing, and the appropriate requester/helper/sign-in action.
  Missing volunteer profiles provide setup in a new tab, preserving the offer draft;
  uncertain offers retain their idempotency key, while profile rejection allows a fresh retry.
- Unified list retains fictional provenance, reports/blocks, owner close/delete and lifecycle
  recovery. Loaded cards remain mounted during refresh to retain notices and focus.

## Verification before deployment

- Repository type checks pass for all workspaces.
- Repository tests: 1,071 passed and 143 infrastructure-dependent skips, plus map and
  exact-location absence checks. Final web recheck: 281 passed.
- PostgreSQL HTTP discovery: 5 passed, including all-area map/directory queries, fine cells,
  block filtering, partial-coordinate rejection and authentication boundaries.
- Focused Chromium: 47 passed, zero retries. Includes 320–1024px navigation, history,
  map selection, pagination focus, location success/three failure modes/recovery, cluster
  split/merge/fade, filter layout, request details, reports/blocks, owner close/delete,
  lifecycle public-sync recovery and offer idempotency/profile recovery.
- Operational release/backup/traceability checks pass. `git diff --check` passes.

The complete browser suite was not rerun. Existing capacity, human-device, notification
and independent-recovery qualification gates are not closed by this UI change.

## Release

Public rollback backup prepared and all six checksums verified at
`/srv/patchwork-public/backups/20260906-before-unified-discovery` on NUC.
Deployment and live-browser results will be appended after verification.
