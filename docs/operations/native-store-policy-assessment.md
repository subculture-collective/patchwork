# Native account and store-policy assessment

Date: 2026-11-15. Investigation for [#245](https://github.com/subculture-collective/patchwork/issues/245),
with remediation in [#246](https://github.com/subculture-collective/patchwork/issues/246).

This is a source/policy assessment for the selected native scope. It is not a
store approval, independent privacy review, live deletion test or authorization
to submit a build. No production accounts, data or external services were changed.

## Decision

Reuse the existing Patchwork cleanup and session-ownership boundary; do not
build a second identity/deletion service just because the route is named
`/account/deactivate`. Before store qualification, establish a clearly named
Patchwork account deletion journey, an accessible outside-app request path,
accurate retention disclosures and tests of object/session cleanup. Keep
independently owned AT/PDS accounts separate from deleting Patchwork data.

Continue the planned AT OAuth native handoff. Prepare a reasoned explanation of
the federated account/content model for Apple review; do not assert that a
login-services exemption is already established. Adding a second login provider
or a local-only identity silo is not justified by this investigation.

## Observed implementation

| Boundary | Source finding | Required conclusion |
| --- | --- | --- |
| Initiation | `http/account-privacy-handler.ts` authenticates `POST /account/deactivate`, executes an idempotent command and clears session cookies | There is an existing authenticated cleanup command; native confirmation/re-auth behavior still needs explicit qualification |
| Public Patchwork data | `account-privacy-service.ts` deletes aid/resource/volunteer projections and owned workflow state | Do not describe a projection deletion as deletion of independently hosted AT records |
| Sessions/preferences | The cleanup deletes browser/OAuth sessions, preferences, consents and notification email/browser-push targets | Extend the same cleanup to native installation targets when those are introduced; token revocation needs caller tests |
| Coordination/groups/chat | Cleanup removes or redacts member state, closes/transfers owned groups and redacts authored chat content | Test authority and counterpart visibility after deletion, rather than assuming every related row should disappear |
| Attachments | Cleanup deletes attachment rows; migration `0019_private_attachment_pipeline.sql` enqueues original/derivative object deletion through a BEFORE DELETE trigger | Durable deletion jobs already exist. Prove worker retries/completion with an isolated object store; do not invent an absent queue |
| Safety/audit data | Cleanup applies bounded safety/audit retention and pseudonymization to several tables | Disclose retained data and verify each subsystem's sweep; a pseudonym is not a promise of anonymization |
| Suppression and receipt | `account_deactivations` is inserted with infinite retention and the full result is written back; the inspected retention service does not prune that result | Separate the minimal anti-resurrection marker from bounded command/result retention, or settle and disclose the longer retention explicitly |
| Published privacy copy | Privacy policy section 6.2 describes deactivation, controlled reactivation, a suppression marker and a final command receipt of up to seven days | Reconcile the result-retention behavior and deletion wording before claiming the policy matches the candidate |
| Payments | Cleanup enqueues cancellation commands and removes/pseudonymizes donor associations | Payments are outside the mobile beta scope, but account deletion must not leave any pre-existing subscription unmanaged |
| AT identity | Cleanup revokes Patchwork's AT session but does not issue a PDS account deletion | Explain what remains under the user's PDS controls, including already federated public copies |

Starting points are `services/api/src/account-privacy-service.ts`,
`http/account-privacy-handler.ts`, `db/retention-service.ts`,
`db/migrations/0013_account_deactivation.sql`,
`db/migrations/0019_private_attachment_pipeline.sql`, `attachment-service.ts`,
`apps/web/src/routes/account-privacy.tsx` and `docs/legal/privacy-policy.md`.
The API paths above are relative to `services/api/src/`.

## Current store requirements and application

Apple requires an in-app way to initiate account deletion when an app supports
account creation; temporary disablement alone is insufficient. Preserve a
straightforward confirmation flow and explain retained data. This applies to
the planned managed signup, even if creation or authentication uses a web
service. [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).

Google requires both an in-app deletion path and an outside-app web request
resource for apps with account creation. A privacy policy alone is not the
request path. The release listing must point to the implemented resource.
[Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).

Apple's login-services rule has privacy requirements and exceptions, including
clients that require a particular third-party account to access that service's
content. Patchwork's federated AT identity is relevant to that analysis, but
its managed signup and private Patchwork workflows make automatic exemption an
unsupported conclusion. Keep anonymous discovery available and document why
AT identity is intrinsic; resolve any reviewer objection before submission
without silently replacing the user-owned identity model.
[Apple App Review Guidelines, section 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services).

## Bounded remediation for #246

1. Define the deletion contract and localized confirmation: removing Patchwork
   data and access, relevant retention/async cleanup, subscription consequences
   if any, and what remains with independently owned PDS accounts. Do not call
   temporary account suspension deletion or silently delete a third-party AT
   account. Confirm actual managed-account ownership before offering any PDS
   deletion action.
2. Reuse the existing authorized/idempotent command where its behavior suffices.
   Add a stable named deletion route/alias only if the caller contract needs it;
   changing the endpoint name alone is not remediation. Test recent-auth or
   another appropriate confirmation boundary for irreversible actions.
3. Provide a directly reachable web deletion/request page and corresponding
   native Settings entry points. Do not make ordinary deletion depend on a
   phone call, generic support inbox or a vague privacy-policy link. Keep the
   unauthenticated entry discoverable while verifying account authority before
   applying deletion.
4. Reconcile the indefinite suppression marker/result with the seven-day receipt
   disclosure. Keep only justified anti-resurrection information indefinitely;
   document it and prove bounded cleanup of other result/command data. Preserve
   safety retention and don't resurrect deleted projections through ingestion.
5. Prove attachment deletion jobs survive retries/restarts and eventually remove
   both original and derivative objects; reconcile orphan cleanup and backups.
   A successful metadata transaction is not evidence of completed object cleanup.
6. Retain compatibility with web clients and future native sessions/targets.
   Update policies to describe actual behavior, including federated copies and
   delayed backup expiry. Record explicit retained-data exceptions and their
   purpose; do not claim immediate physical removal from every backup.

Acceptance must cover authorized initiation, missing/expired/wrong-account
credentials, uncertain-response retry, immediate session/target invalidation,
private-field redaction, bounded receipts, object worker failure/recovery and
post-deletion replay. Use isolated identities and data only. Existing account
privacy PostgreSQL, retention and attachment suites are the starting harnesses;
the spike did not run those destructive integration journeys against live data.

## UGC, SDK and review package

Native reports/blocks and moderated/quarantined states must be implemented in
the member issues; route existence alone does not qualify native UGC handling.
Show the stated moderation/contact process and avoid portraying server-readable
chat as end-to-end encrypted. The current project still has independent review
and operational qualification gates; a native build does not waive them.

The selected map, WebRTC and push dependencies need an actual SDK/version/data
inventory once the feasibility issues choose them. Review manifests, required
API reasons, location purpose text, FCM/device identifiers and any telemetry
against observed behavior before filling Apple privacy/Google Data safety
forms. Nothing in this spike certifies an unselected SDK. Refer to current
[Apple review/privacy requirements](https://developer.apple.com/app-store/review/guidelines/)
and [Google Play user-data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
at candidate qualification.

## Answer and remaining gates

The investigation identifies a reusable cleanup boundary and concrete gaps;
#246 owns the behavior/copy/request-path changes. #248 can implement the native
AT handoff against that existing identity model. #302/#303 own native privacy
controls; #309/#310 own real-provider/device evidence; #312/#313 own the final
store package and reviewer-facing login explanation. App Review's interpretation
of section 4.8 remains a store gate, not a fabricated approval or an instruction
to collect another identity now. No enrollment, payment, submission, live
deletion or automatic public release is part of this assessment.
