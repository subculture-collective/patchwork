# Public group join requests (#134)

A signed-in neighbor opens `/groups?group=<id>` to see only a public group’s name, purpose, description and active member count. Private, closed and unavailable groups share the same 404 response. There is no directory.

Use one free-text introduction (1–1000 characters, no control characters), a seven-day pending lifetime matching invitations, and 90-day request retention matching invitation records. The application thread uses the existing bounded, server-readable chat with a new request scope. Only the applicant and current owner/moderators can access it while pending. Decisions, withdrawal, expiry and closure end chat access. All join operations recheck account, block and moderation eligibility. Approval grants only member through the invitation membership helper; the group row serializes decisions and replies.

## Implementation and verification

1. Add an additive migration for requests, chat scope and audit/notification actions. Preserve existing invitations, direct chat and room chat. Add shared eligibility checks and membership insertion. PostgreSQL checks must prove private-group non-disclosure, duplicate prevention, concurrent decisions, dynamic moderator access, block and moderation checks, and expiry.
2. Add authenticated, idempotent HTTP commands and link-only detail/read endpoints. Keep introduction and replies out of notification payloads. Export only the account’s own requests; remove introductions and redact decision identity on deactivation. Sweep expired requests and delete retained requests with cascading private chat.
3. Add English/Spanish detail, request, moderation and thread links in the group page. Browser tests use two disposable browser identities with mocked HTTP to cover request, reply and approval; real PostgreSQL tests cover the service transaction and authorization boundaries.
4. Run focused tests, workspace types/build, full unit and PostgreSQL suites, browser regressions, operations and documentation checks. Publish a PR and wait for required hosted checks.

## Rollout and rollback

Apply the migration before the matching API. Existing API readers do not recognize the new chat kind, so API readers must be updated together before enabling the new web flow. Roll back the web entry points first and retain the matching API/schema for existing requests; do not drop request data or chat constraints during rollback. No shared runtime migration or deployment is part of this change.

## Verification record

The focused database suite covers duplicate requests and idempotent replay, concurrent moderator decisions, a reply racing approval, current-role access, bilateral blocks, moderation/deactivation, expiry, cascading retention, export and redaction. The browser journey runs separate applicant and moderator contexts in English and Spanish, with HTTP fixtures; it is not a credentialed live OAuth/PDS qualification.

The browser journey exposed the shell dropping the `group` query parameter before authentication completed. The parameter now survives URL synchronization. Chat clears displayed messages after a failed access read so revoked application access does not leave the previous response visible.

A fresh dependency audit also found high-severity decoder advisories in MinIO’s CommonJS query-string chain. The version 0.5.1 parser is copied unchanged from its integrity-verified upstream package, with a small CommonJS adapter documented in `vendor/decode-uri-component/README.md`. Both query parsing and a network-free MinIO presigned URL check pass on Node 22. The Docker dependency stage copies the local package before installation. The high/critical audit gate passes; two moderate findings remain in MinIO’s stream-json chain.

Final local suites: 1,074 unit tests, 199 PostgreSQL tests, and 209 Chromium tests passed (16 browser cases skipped). Workspace typecheck, operational controls, postal geography parity, 70 exact-location absence surfaces, documentation links and diff checks passed. Hosted PR checks and deployment remain separate evidence.

## Hosted CI storage repair

Run 17538 passed quality gates, all PostgreSQL tests and fresh migrations. The real attachment-provider test failed on its first MinIO write with `XMinioStorageFull`. A local comparison using the same built MinIO image reproduced that failure on the runner’s backing filesystem and passed with a bounded 1 GiB `/data` tmpfs. CI now mounts that disposable data path with the existing MinIO service UID/GID (10001) and mode 0700. The repair retains MinIO’s free-space guard and the real upload/quarantine assertions; it does not delete host data or change runtime storage.

The real attachment integration test passed locally against disposable MinIO, ClamAV and PostgreSQL with the new mount, including transformed clean bytes, test-signature quarantine, access denial and deletion. YAML parsing, startup shell syntax and diff checks passed. All three disposable fixtures were removed after the test.
