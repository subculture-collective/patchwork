# Lexicon schemas and versioning (Phase 2 / P2.1)

This document defines the v1 AT Lexicon schema set, constraints, and evolution policy.

## v1 schema set

> Current runtime scope: `app.patchwork.aid.post`,
> `app.patchwork.volunteer.profile`, and `app.patchwork.directory.resource` have
> authenticated repository paths. `app.patchwork.conversation.meta` and
> `app.patchwork.moderation.report` remain prohibited runtime writes under ADR
> 0003 and must not be presented as active public-record capabilities.

Records are currently published at:

- `app.patchwork.aid.post`
- `app.patchwork.volunteer.profile`
- `app.patchwork.conversation.meta`
- `app.patchwork.moderation.report`
- `app.patchwork.directory.resource`

Revision map:

- `app.patchwork.aid.post`: `1.0.0`
- `app.patchwork.volunteer.profile`: `1.1.0`
- `app.patchwork.conversation.meta`: `1.0.0`
- `app.patchwork.moderation.report`: `1.0.0`
- `app.patchwork.directory.resource`: `1.1.0`

Canonical schema JSON files live in:

- `packages/at-lexicons/src/lexicons/*.json`

Executable validators and typed record models live in:

- `packages/at-lexicons/src/validators.ts`

## Field-level constraints (summary)

### `app.patchwork.aid.post`

Required fields:

- `$type`, `version`, `title`, `description`, `category`, `urgency`, `status`, `location`, `createdAt`

Key constraints:

- `title`: 1..140 chars
- `description`: 1..5000 chars
- `urgency`: `low | medium | high | critical`
- `status`: `open | in-progress | resolved | closed`
- `location.precisionKm`: 1..50 for the alpha public-location policy

### `app.patchwork.volunteer.profile`

Required fields:

- `$type`, `version`, `displayName`, `capabilities`, `availability`, `contactPreference`, `createdAt`

Key constraints:

- `displayName`: 1..80 chars
- `capabilities`: non-empty array
- `availability`: `immediate | within-24h | scheduled | unavailable`
- `skills` (optional): non-empty array, each item 1..64 chars
- `availabilityWindows` (optional): non-empty array, each item 1..64 chars
- `verificationCheckpoints` (optional): identity/safety/reference status object
- `matchingPreferences` (optional): preferred categories + urgencies + max distance

### `app.patchwork.conversation.meta`

Required fields:

- `$type`, `version`, `aidPostUri`, `participantDids`, `status`, `createdAt`

Key constraints:

- `aidPostUri` must be `at://...`
- exactly 2 participant DIDs
- `status`: `open | handoff | closed`

### `app.patchwork.moderation.report`

Required fields:

- `$type`, `version`, `subjectUri`, `reporterDid`, `reason`, `createdAt`

Key constraints:

- `subjectUri` must be `at://...`
- `reporterDid` must be DID-formatted
- `reason`: `spam | abuse | fraud | other`

### `app.patchwork.directory.resource`

Required fields:

- `$type`, `version`, `name`, `category`, `serviceArea`, `contact`, `verificationStatus`, `createdAt`

Key constraints:

- `name`: 1..120 chars
- `serviceArea`: 1..120 chars
- `contact`: must include at least one of `url` or `phone`
- `verificationStatus`: `unverified | community-verified | partner-verified`
- `location` (optional): bounded lat/lng + precisionKm + optional areaLabel
- `openHours` (optional): 1..200 chars
- `eligibilityNotes` (optional): 1..500 chars
- `operationalStatus` (optional): `open | limited | closed`

## Semantic versioning policy

- **PATCH**: doc clarifications or non-breaking validator bug fixes.
- **MINOR**: backward-compatible additive fields (optional only).
- **MAJOR**: breaking field removals/renames/constraint tightening.

Migration notes are required for MAJOR changes.

## Fixtures and validation evidence

Fixtures used by tests:

- Valid: `packages/at-lexicons/src/fixtures/valid/*.json`
- Invalid: `packages/at-lexicons/src/fixtures/invalid/*.json`

Validation and schema coverage tests:

- `packages/at-lexicons/src/lexicons.test.ts`
