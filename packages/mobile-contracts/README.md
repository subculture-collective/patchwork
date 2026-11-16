# Mobile wire fixtures, slice 1

Addresses [#247](https://github.com/subculture-collective/patchwork/issues/247).
These bundled JSON files can be copied into Swift/Kotlin test resources without
a JavaScript runtime or generated client SDK. This directory is fixture-only;
it is not another npm workspace or a replacement server contract.

## Authority and verification

`services/api/src/mobile-wire-contracts.test.ts` compares the golden feed
examples to `PostgresProjectionQueryService.queryFeed` and its production
`queryProjected` presenter. It supplies a deterministic SQL-page double, not a
database. Error examples come from current query validation and `toPublicError`.
Existing PostgreSQL/HTTP suites remain the proof of database filtering and
route authorization. No fixture contains an actual account or private location.

```sh
rtk proxy node scripts/test.mjs unit services/api/src/mobile-wire-contracts.test.ts
rtk proxy npm run typecheck -w @patchwork/api
```

The JSON Schema fragments describe this reader-facing slice, not the complete
API or AT record lexicons. The same test validates fixtures against the schema,
rejects malformed required fields and allows additive fields/unknown state
strings. Schema evolution must be checked against actual server responses.

## Route inventory

| Surface | Current boundary | Fixture/limit |
| --- | --- | --- |
| Public discovery | `GET /query/feed`; `page`, `pageSize`, `dataset`, post/category/status/search and optional selected-area filters | This slice covers feed responses and invalid page input; global Latest does not require GPS |
| Map/directory/profile reads | `/query/map`, `/query/directory`, `/query/volunteers`, public organization/resource detail routes | Later slices add their own current handler examples; feed is not a complete map/resource contract |
| Browser AT login | `POST /oauth/login`, `GET /oauth/callback`, `/auth/session`, `/auth/refresh` | Existing browser completion uses cookies; native handoff is future #248, not supplied by this fixture set |
| Authenticated member commands | Existing post/lifecycle, coordination, groups and bounded `/chat/*` handlers | Session-derived authority and command idempotency remain server concerns; this slice does not grant mutation permission |
| Notifications | `/notifications` and browser subscriptions at `/notifications/push` | Native installation/APNs/FCM registration is future work, not `/push/register` |
| Errors | Stable `error.code` and safe `message`; optional `details` and `requestId` vary by handler | Match known codes to localized text; unknown codes use a safe localized fallback |

Route paths are relative to the configured API base, including any deployment
`/api` prefix. `/chat/initiate` and `/push/register` from the old scaffold are
not current routes. Public HTTP response models are separate from versioned AT
repository record schemas; do not publish response/ranking fields into an AT post.

## Case inventory and consumer rules

- `feed-global`: synthetic offer without public coordinates or distance; nullable
  freshness. Do not invent a marker for an unlocated record.
- `feed-area`: synthetic county-scoped offer with a server-canonical county
  point, approximate precision and known freshness. ZIPs are strings, preserving
  leading zeroes; a county ID is not a ZIP or a personal point.
- `feed-empty`: an empty successful page is distinct from an error or offline.
- `feed-legacy`: explicit compatibility variant without `postType`, origin,
  timestamps or freshness. Missing post type defaults to request; missing origin
  defaults to visitor-created, never synthetic. This is not an old-server run.
- `feed-additive`: explicit future-reader variant with extra fields and an
  unknown status. Preserve identity/displayable data and disable unsupported
  actions; never coerce an unknown status to open or completed.
- `error-invalid-query`, `error-auth`, `error-internal`: current safe envelopes
  with/without a request ID. Diagnostic exception text is not a public message.

Swift tests should bundle these files, decode through `Codable` DTOs and assert
optionals, nullable freshness, empty pages and an explicit unknown-state case.
Kotlin tests should use their selected serializer with unknown keys ignored,
nullable/defaulted optional properties and a raw-string/unknown state mapping.
Strict enum decoding must not turn a new server status into an app crash.
Neither platform may infer authority from record origin or a decoded status.

Native decoding is documented here, not claimed as passed: the native app/test
projects are created by #249/#250. Their first screen slices must consume these
same files. Extend fixtures and production-boundary assertions per feature;
do not regenerate goldens blindly when a server change breaks the comparison.
