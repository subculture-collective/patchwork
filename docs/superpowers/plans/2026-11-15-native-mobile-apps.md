# Patchwork native mobile first-release plan

Date: 2026-11-15. Status: planning complete for the interviewed product scope;
technical feasibility and device qualification remain unverified.

GitHub delivery tracking: [native-app roadmap #210](https://github.com/subculture-collective/patchwork/issues/210).
The roadmap expands the units below into separate platform/feature PR issues
with native blocking dependencies. [Release epic #211](https://github.com/subculture-collective/patchwork/issues/211)
retains private-beta and store qualification. Tracker publication does not
establish implementation or release evidence.

Architecture: [ADR-0005](../../architecture/adr/0005-separate-native-mobile-apps.md).
This is a mobile product plan alongside the existing
[web charter](../../product/buyer-ready-web-charter.md), not a rewrite of that
charter or authorization to operate a public mutual-aid service.

## Goal and owner decisions

Deliver independent Swift/SwiftUI iOS and Kotlin/Jetpack Compose Android apps
for Patchwork. Keep Patchwork's brand with platform-native behavior. Ship
installable builds for private testing first, then qualify store releases.

The owner selected everyday member flows, with organization administration
remaining on the web. The owner explicitly included scheduling, groups, group
chat and live exact-location exchange in the first private beta. Offline use
is limited to recently loaded discovery and request/offer drafts; all shared
changes require a connection.

In the follow-up, the owner explicitly required localization so translations
are easy to use and maintain. This is foundation work for both apps, not a
translation pass deferred until the screens are finished.

## Product scope

| Area | First private beta |
| --- | --- |
| Discovery | Anonymous map/list discovery, requests/offers, resources, public organization and volunteer details; search, filters, pagination, attribution and explanations for existing recommendations |
| Identity | Existing AT account login, managed Patchwork signup, current 18+ and versioned policy consent, session restore/refresh/logout |
| Requests and offers | Create, edit, close/delete where permitted; respond, accept/decline, withdraw/cancel; existing multi-helper pickup behavior |
| Coordination | Participant inbox, accepted connections, scheduling proposals/decisions, outcomes and feedback |
| Chat | Accepted-connection text chat, pagination, read state, redaction and reporting; group-room and join-request conversations |
| Groups | Create and manage within existing member capabilities; public-link join requests/decisions, invitations, membership/roles, departure/ownership and rooms/closure |
| Live exact location | Explicit consent by both accepted-connection participants; encrypted, time-limited exchange with stop/revoke and failure handling |
| Notifications | In-app center and preferences, native opt-in push, badges and authorized deep links; existing email preferences |
| Profile/account | Volunteer profile and availability, language, preferences, export, deactivation and a store-qualified deletion path |
| Safety | Reports, blocks, moderation/maintenance states, synthetic/source labels, private-data boundaries and clear non-emergency positioning |
| Attachments | Existing safe image/PDF selection, upload/scan status, authorized viewing and deletion where the member workflow permits it |
| Offline | Bounded public discovery cache and account-scoped local request/offer drafts; no pending shared-state mutations |
| Localization | Externalized interface copy, native plurals/formatting, translator handoff, language selection/fallback and checks for translation completeness; start with the existing English/Spanish product baseline |

Donations, organization/resource stewardship and verification administration,
platform moderation administration, offline map packs, queued offline writes,
background location tracking, in-app travel itineraries, OS calendar integration,
widgets and watches are
outside this first release. Public organization/resource information stays in
scope. Unsupported administrative actions may open a clearly labeled web
destination; core member flows must work natively.

The following are recommended defaults rather than additional owner decisions:
phone-first layouts; English and Spanish; light/dark appearance; accessible
larger text and screen-reader support; foreground-only live exact exchange.
Do not claim dedicated iPad/tablet support until separately tested. Resolve
minimum OS versions against available test hardware and the map/WebRTC
dependencies in F01; prefer broad reach over optional new OS features.

## Experience and navigation

Use five destinations: Discover, My activity, Groups, Notifications and Profile.
Discover switches between map/list views and requests/offers/resources. A
prominent Post action opens a request-or-offer composer. My activity contains
owned posts, offers, connections, scheduling, outcomes and connection chat.
Groups contains memberships, invitations, applications and authorized rooms.

On iOS, use SwiftUI navigation stacks, sheets and platform back behavior. On
Android, use Compose navigation, Material controls and system back behavior.
Share semantic names and journeys without requiring identical screen layouts.
Validate this navigation with a screen/state inventory before feature work;
five destinations are a proposal, not an owner-mandated tab arrangement.

Carry over the paper/pine/terracotta brand, patch shapes and bundled licensed
fonts from [the design system](../../design-system.md). Adapt decoration to
native controls and text scaling. Include loading, empty, stale, unauthorized,
offline, maintenance and retry states in every relevant journey. No GPS prompt
on launch; ZIP/county discovery and posting work without location permission.

## Repository and client architecture

Keep `apps/web` and the services in place. Add `apps/ios` for the Xcode project,
Swift sources, assets and tests, and `apps/android` for the Gradle project,
Kotlin sources, assets and tests. Both remain part of this repository without
pretending that native builds are npm workspaces. Start with feature folders
and small shared client services; split into modules only when needed.

| Concern | iOS recommendation | Android recommendation |
| --- | --- | --- |
| UI/state | SwiftUI, observation and structured concurrency | Compose, ViewModels, coroutines/Flow |
| HTTP/models | URLSession and Codable | One maintained HTTP client and Kotlin serialization, selected/pinned in F01 |
| Sessions | Keychain with appropriate device/access controls | Keystore-backed protection for app-private session storage |
| Cache/drafts | Native persistent store with explicit backup/expiry rules | Room or equivalent app-private store with explicit backup/expiry rules |
| Maps | MapLibre Native behind a small SwiftUI adapter, subject to F01 proof | MapLibre Native behind a Compose adapter, subject to F01 proof |
| Browser login | ASWebAuthenticationSession | System-browser/Custom Tabs flow |
| Push | APNs | FCM; document Google Play services dependency |
| Exact exchange | Pinned native WebRTC distribution, subject to F01 review | Pinned native WebRTC distribution, subject to F01 review |

SwiftUI and Compose own their app interfaces. An SDK map view wrapped in the
native UI is compatible with this choice; a web map inside a WebView is not
the proposed fallback. Verify the current PMTiles archive, range requests,
style assets, attribution and ZIP/county layers on both native SDKs. Do not
assume the current Leaflet/Protomaps renderer or styles can be copied directly.

Contract work covers only the endpoints each delivery unit uses. Current API
handlers and executable shared validation are authoritative; produce reviewed,
language-neutral examples/schema fragments from that boundary and reuse them
in Swift/Kotlin decoding and error tests. Begin with explicit small DTOs; avoid
a repository-wide code-generation migration. Additive server fields should
not break old clients. Unknown states must disable unsupported actions safely.
Pin toolchains/dependencies after F01 and record licenses and build provenance.

## Localization and translation workflow

Use iOS `Localizable.xcstrings` String Catalogs and Android
`res/values/strings.xml`, `res/values-es/strings.xml` and plural resources.
Screens access localized resources through SwiftUI/localized string APIs and
Compose `stringResource`/`pluralStringResource`, rather than embedded display
copy. Include navigation, validation, errors, accessibility labels, permission
purpose text, notifications, empty/offline states and safety/consent text.
Mark product names and intentional non-translatable values explicitly.

Use stable semantic message IDs, such as `request.offer.accept`, with an
explicit mapping to Android-safe resource names. Keep the same ID for shared
meaning across web/iOS/Android; allow documented platform-specific messages
where interactions differ. Give translators context, named argument meanings,
plural intent and any length constraints. Never build a sentence by joining
translated fragments or assume English word order. Use native plural rules
and locale-aware date/time/number formatting while retaining Patchwork's
product rules for distance units and scheduling timezones.

Seed shared member-flow copy from `apps/web/src/i18n/en.json` and `es.json`
after reviewing it in native context. Do not copy i18next interpolation/plural
syntax directly into either native format. L01 defines the key mapping and
conversion/validation rules, with representative plural and argument fixtures.
Native resource catalogs are the maintained source for native copy after
import; do not create a third manually edited master or bidirectional sync.
Share a glossary and translation memory across clients, and track source-copy
changes so existing translations become review-needed rather than silently
remaining approved. Existing Spanish text is input, not proof of human review.

Document how a translator receives and returns files: Xcode localization
exports/XLIFF for iOS and standard Android XML resources for Android. Changes
return through version control, with a preview/test pass and review status.
No paid translation service or live translation API is required. Ship bundled
catalogs so interface translations work offline; defer over-the-air copy
updates and automatic translation of user-generated content.

Use the system/app language by default, with an explicit in-app language
choice and a documented English fallback for unsupported locales. Persist the
choice and apply it across navigation, accessibility and future notifications;
refresh or refetch server-owned copy when the language changes. Keep device
regional date/number formatting separate from interface-language selection.
Do not translate server error prose at runtime: map stable error codes to
localized messages, including an unknown-error fallback. Reuse the existing
account language preference for server-generated email/push where supported.
The current onboarding schema and notification code support only `en`/`es`;
adding a later language also requires updating that server locale registration
and translated server copy. Do not advertise a language the server cannot use.

Every feature unit adds its resource keys and reviewed translations with its
screens. CI must detect missing required keys, stale/unreviewed release
translations, incompatible format arguments and plural mistakes, with explicit
exceptions for intentional fallback/non-translatable text. Check shared-key
meaning/argument parity across native catalogs without requiring their entire
key sets to match. Audit user-visible literals; catalog completeness alone
cannot prove every screen uses localization APIs.

Use expansion/accent and RTL pseudolocales before beta acceptance. Check
truncation, large text, bidirectional layout, plural cases and locale changes
on both platforms. This checks readiness for more languages; it does not claim
that an actual RTL language is translated or supported. Adding a language
should mean importing translations, registering support and running these
checks, without changing individual screen implementations.

## Backend integration work

### Native sign-in and session ownership

Keep the existing server AT OAuth adapter and encrypted PDS credentials. The
current API can authenticate a Patchwork session through a bearer header, but
`POST /oauth/login` and `GET /oauth/callback` finish in browser cookies.

Add a distinct native start/completion path with an allowlisted app callback,
state binding and a short-lived, single-use handoff code bound to a verifier
held by the initiating app. Exchange that code over HTTPS for a bounded
Patchwork session. Never put a reusable session or PDS token in a redirect URL.
Treat this as a Patchwork handoff around existing AT OAuth, not an assertion
that an arbitrary mobile OAuth library implements AT's DPoP/PAR requirements.
Document exact request/response shapes in B01 before clients consume them.

Native HTTP requests use explicit bearer sessions and no ambient browser
session cookie. Keep the existing browser CSRF checks intact and test mixed
cookie/bearer conflicts. Audit refresh lifetime, revocation, logout and account
deactivation across both clients. No app-held client secret. Managed signup
must lead to the same user-owned AT identity and native login flow; do not
create local-only identities or replace provider-hosted sign-in with a
password form. The existing managed-account creation path needs its own
review for transient password handling and platform UX.

### Notifications and links

Extend the durable outbox with authenticated native installations and APNs/FCM
targets, preserving browser push. Cover opt-in, multiple devices, token
rotation, account switching, logout/deactivation, invalid-token cleanup,
retries and duplicate delivery. Installation IDs are scoped to delivery;
avoid advertising identifiers or unrelated device fingerprint headers.

Payloads contain safe event identifiers and generic copy, never chat bodies,
exact coordinates, reports, private evidence or attachments. A tap fetches
current authorized state. Do not trust a notification as permission to open a
room or connection. Add verified HTTPS app/universal links with web fallback;
allowlist routes and handle signed-out, deleted and revoked destinations.

### Live exact-location exchange

Use the existing `/location/consent`, `/location/session`, `/location/signal`
and `/location/revoke` boundaries and preserve their participant checks.
The inspected service uses a two-minute consent window and five-minute
session lifetime. The web implementation uses a WebRTC data channel,
participant proofs and `iceServers: []`; that is not evidence of successful
communication between phones on different networks.

F01 must prove a compatible native WebRTC data channel and B04 must qualify
STUN/TURN requirements. Prefer a controlled, authenticated TURN relay where
needed: encrypted data-channel packets may be relayed, but plaintext personal
coordinates must not become an API payload or relay log. Infrastructure
deployment and its operating costs are a separate implementation dependency;
this planning change deploys nothing. Check native/native and native/web
interoperability, including the existing proof and signaling formats.

The proposed mobile behavior is live updates only while the dedicated sharing
screen is visible, both participants have consented and the session remains
authorized. Show who can see the location, remaining time and Stop sharing.
Cancel on background/lock, lost permission, disconnect, expiry, logout,
blocking, connection closure or moderation/maintenance denial. Require fresh
consent for a new session. Do not silently switch to a persisted location or
background tracking. Connection chat remains server-readable; only the exact
exchange has the encrypted peer-channel boundary.

Keep own/peer coordinates, peer proofs and exact-view state in memory only.
Exclude them from local databases, backups, notifications, saved navigation,
HTTP caches, URLs, analytics, crash reports, logs and recorded QA artifacts.
Clear app-switcher previews and use available capture protections without
claiming that either OS prevents all screenshots or that a recipient can be
made to forget a location. Do not pass a private coordinate into an external
maps URL. The exact-view renderer must not persist its camera/marker state or
leak it through SDK telemetry. Validate refresh cadence, freshness and data
retention with canary tests before enabling actual location input.

### Offline and local privacy

Cache bounded public discovery only, with fetch time and stale labels. Do not
persist private chat, member lists, applications or exact-location state for
offline access in this release. Use a proposed 24-hour discovery TTL and
seven-day draft expiry; confirm these constants during the cache/draft unit.
Request/offer drafts contain no GPS point or attachment bytes. Drafts may
still contain sensitive prose, so protect them with platform storage controls,
exclude them from cloud/device backup and isolate them by account. Clear drafts
on logout, account change or deactivation; explain this before logout.

Never auto-publish on reconnect. Refresh current server state before every
protected action. Preserve idempotency keys for retrying an uncertain online
response; explicitly distinguish that from a general offline queue. A lost
response must not create a second offer, acceptance or message. An unaccepted
network write is never displayed as a completed shared action.

## Ordered delivery units

Each row names a bounded review unit. Rows with paired IDs mean two separate
platform PRs, each with its own checks. Backend units land before clients that
depend on them. F01 resolves feasibility first; build feature slices on both
platforms in the same order rather than finishing one entire app first.

| Unit | Dependency | Deliverable and acceptance |
| --- | --- | --- |
| F01 — native feasibility | This plan | Minimal build/run on iOS and Android; real PMTiles/geography rendering; WebRTC proof exchange with synthetic payloads; dependency/license/OS matrix; named Mac, Android and signing prerequisites. This is a technical slice, not beta completion. |
| C01 — mobile contract fixtures | F01 | Current discovery/auth/error fixtures and a route inventory, then additions with each feature. Server-owned examples decode in both native test runners; obsolete `/chat/initiate` and `/push/register` are excluded. |
| L01 — localization foundation | F01 | Native resource conventions, shared-key/glossary mapping, reviewed English/Spanish seed, interpolation/plural conversion fixtures, translator export/import guide and completeness checks. Validate one representative screen per platform, including language change and pseudolocalization. |
| B01 — native auth handoff | C01 | Start/exchange/session contract, single-use verifier-bound completion, expiry/replay/redirect tests, cookie-CSRF regression coverage. Existing browser login behavior still passes its tests. |
| I01 / A01 — app foundations | F01, C01, L01 | Native projects, environment/build identity, navigation, bundled branding, native localized resources/language selection, light/dark and test harnesses. A clean checkout builds without signing secrets. |
| I02 / A02 — discovery | I01/A01 | Anonymous map/list/resources/details, ZIP/county semantics, search/filter/page/error/maintenance states and bounded public cache. List navigation remains usable without a map gesture or location permission. |
| I03 / A03 — identity/account | B01, I01/A01 | Provider login, managed signup, consent, restore/refresh/logout, profile, preferences, export and current deactivation. Test cancellation, interrupted callback, revoked/expired session and account switching. Store deletion assessment is tracked in B05. |
| I04 / A04 — requests/offers | I02/A02, I03/A03 | Composers/drafts, owned posts, lifecycle, responses/acceptance and multi-helper capacity; online-only mutations, idempotent uncertain-response recovery and safe attachments. |
| I05 / A05 — connection journey | I04/A04 | Inbox, accepted connections, scheduling/timezones, outcomes and connection chat with current permission checks and safe foreground refresh. Blocking or closure removes access. |
| I06 / A06 — groups | I03/A03, I05/A05 | Membership/invites, public-link applications and authorized decisions, participant roles, rooms, room chat and join-request threads. Test private-group nondisclosure, role loss, removal, block and closure. |
| B02 — native push backend | B01 | Native installation storage/transport adapters and safe outbox fan-out, retry/rotation/revocation tests; browser notification tests remain green. |
| I07 / A07 — safety surfaces | I04/A04, I05/A05, I06/A06 | Reports/blocks from relevant profiles, content and chats; block management, quarantine/maintenance messages, consent renewal and attachment rejection states. Test that revocation clears private views rather than leaving readable stale screens. |
| I08 / A08 — notifications/links | B02, I05/A05, I06/A06 | In-app preferences, native permission and token lifecycle, app links, authorized tap routing and badge refresh; real APNs/FCM foreground/background/terminated tests. |
| B04 — exact transport readiness | F01, B01 | Compatible native signaling contract; test-only canary peer path across separate networks; authenticated short-lived relay configuration and no sensitive logging. Record any required deployment separately. |
| I09 / A09 — exact exchange | B04, I05/A05, I07/A07 | Consent, authenticated encrypted channel, bounded foreground live updates, stop/expiry/revocation, in-memory cleanup and cross-client interoperability. No acceptance based only on same-Wi-Fi or synthetic tests. |
| B05 — account/store gap closure | I03/A03 assessment | Assess actual deactivation against deletion requirements, AT identity ownership and retention. Implement any missing server/web path and matching app entry points; document third-party AT data limitations. Assess Apple's login-services rule without assuming an exemption or a need for a second identity silo. |
| I10 / A10 — private-beta qualification | All corresponding feature units, B05 | Complete the scenario matrix below on physical phones, resolve critical accessibility/privacy failures, produce signed installable artifacts with exact source/build identity and rollback instructions. |
| R01 — store qualification | Both private betas accepted | Current policy review, privacy declarations, permission purpose strings, age/UGC disclosures, review access, support/deletion URLs, screenshots and submitted candidate identity. Store approval and public-service launch remain separate decisions. |

Client units extend contract fixtures as needed; C01 does not have to describe
the entire API before discovery work begins. Implement missing API capability
as a focused prerequisite rather than embedding domain authorization in a client.
Audit imports and remove the old TypeScript mobile package and obsolete-only
shared exports after both foundations have their replacement coverage; do not
delete shared types still used by web/services.

## Verification and release gates

Maintain one scenario matrix with separate iOS, Android and cross-client
results, exact commit/build, OS/device and environment. Distinguish fixture,
real-provider, simulator, physical-device and hosted-CI results. This document
records no passing native checks.

| Scenario | Required proof before private-beta acceptance |
| --- | --- |
| Anonymous discovery | Fresh install without permissions; correct ZIP/county requests and approved-resource addresses; filters, no results, stale cache and no network |
| Authentication | Real provider login and managed signup, cancellation, callback replay rejection, cold-start restoration, expiry/refresh, logout and account isolation |
| Mutual-aid journey | Two disposable accounts on different clients: create, offer, accept, schedule, chat, complete and record outcome; capacity/duplicate/conflict cases |
| Groups | Public-link application and private invitation; authorized decisions, room conversation, role change, removal/departure and access revocation |
| Native push | Actual APNs/FCM delivery with app foregrounded, backgrounded and terminated; denied permission, rotated token, wrong account and revoked destination |
| Exact location | iOS/Android, same-platform pairs and native/web; separate networks and relay path; consent/permission denial, stale sample, revoke/expiry/background/network loss; bounded authorization rechecks |
| Data absence | Canary coordinate/proof absent from DBs, cache/drafts, backups, request URLs, notification payloads, logs, crash/analytics and QA artifacts; clear local state after every exit |
| Safety/account | Block/report, moderation and maintenance denial, export/deactivation/deletion, attachment quarantine and unauthorized link targets |
| Native usability | Physical-phone keyboards/back navigation, VoiceOver/TalkBack, large text, reduced motion, light/dark and English/Spanish; empty/error/offline states |
| Localization | English/Spanish critical journeys and permissions/safety copy, translator export/import round trip, key/argument/plural checks, language switching/fallback, offline bundled copy and expansion/RTL pseudolocales; verify server notification language separately |
| Performance/lifecycle | Record cold-start, map/list responsiveness, memory and exact-sharing battery measurements on named reference phones; agree regression budgets from F01 baselines, stop foreground polling when backgrounded, and test process death/state restoration |
| Build/install | Clean-checkout builds, signed private install, upgrade without account/data crossover, dependency inventory and exact artifact/source identity |

Use `xcodebuild` build/test and XCUITest on a named Mac/Xcode destination;
use the checked-in Gradle wrapper for `lint`, `testDebugUnitTest`,
`assembleDebug` and `connectedDebugAndroidTest`. F01 must supply exact scheme,
destination, JDK/SDK versions and commands before implementation is handed off.
Those projects and commands do not exist yet. Reuse API unit/PostgreSQL suites
and the browser auth journey for relevant server changes. Run the existing
exact-location-absence check plus new native storage/payload canary checks.

CI needs a qualified macOS execution path for iOS and Android SDK/device access
for Android. Verify actual repository origin, active workflows, runner capacity
and branch protection before adding jobs: this checkout's writable source
remote is GitHub, while older acceptance prose and `.gitea` workflows describe
Gitea. This plan does not change CI ownership or publish tracker issues.

Use separate development/staging/release app configurations and installation
identities where needed to avoid overwriting an existing tester app. Reconfirm
bundle/package identifiers, Apple team, signing access, push environments,
associated domains and test-device access before beta distribution. Private
iOS distribution also needs the appropriate Apple account/signing setup.
No credentials belong in the repository or build logs.

Server additions must remain compatible with existing web clients and installed
mobile builds. Mobile rollback means retaining a known signed build and
compatible API behavior; a server revert must not assume every installed app
has been upgraded. Read-only/maintenance state disables protected actions.
Disable a broken exact exchange with a clear unavailable state, never with a
persisted-coordinate fallback. A beta missing an included feature is an
interim build, not an accepted first beta under this scope.

## Store-specific decisions to resolve early

Apple requires an in-app account deletion initiation path for apps supporting
account creation; temporary disablement alone is insufficient. Google also
requires an outside-app request path. Assess the current destructive cleanup
and retained records by behavior, not by the `/account/deactivate` route name.
Do not silently delete a separately owned AT/PDS identity when removing a
Patchwork account. Explain public/federated copies and retained information.

Assess Apple's login-services guideline against Patchwork's AT identity model
and managed signup, and document the reasoning for review. Do not presume
either automatic exemption or mandatory Sign in with Apple. Review current
UGC/report/block and moderation requirements and any selected SDK disclosures.
Donations remain outside the first release; adding them later needs its own
store/payment assessment.

## Remaining implementation prerequisites

The product interview is resolved. F01 must establish the build Mac, physical
phone access, OS floors, SDK choices and artifact distribution path. B04 must
establish reliable cross-network exchange and any relay operation requirements.
B05 must resolve store account/login semantics. These are evidence-gathering
tasks with concrete outputs, not reasons to reopen the settled product scope.
Do not give a calendar completion date before those findings exist. The
recommended next step is F01, followed by contracts/auth and paired native
foundations. The issue breakdown is published through roadmap #210;
implementation has not been started in this planning session.

## Sources and inspected boundaries

Repository evidence: `apps/mobile/src/{api-client,push-notifications,offline-sync-mobile}.ts`,
`services/api/src/index.ts`, `services/api/src/http/{authenticated-request,csrf,chat-handler,notification-handler}.ts`,
`services/api/src/{durable-notification-service,exact-location-signal-service,account-privacy-service}.ts`,
`apps/web/src/features/exact-location-exchange.tsx`,
`docs/architecture/postal-geography.md`, and `docs/current-acceptance.md`.
These are source observations, not current hosted or device qualification.

Official sources consulted for this plan on 2026-11-15; recheck before pinning
SDKs or submitting builds:

- [Apple web authentication sessions](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession)
- [Android architecture recommendations](https://developer.android.com/topic/architecture/recommendations)
- [AT Protocol OAuth profile](https://atproto.com/specs/oauth)
- [MapLibre Native](https://maplibre.org/projects/native/) and [iOS PMTiles documentation](https://maplibre.org/maplibre-native/ios/latest/documentation/maplibre-native-for-ios/pmtiles/)
- [FCM Android setup and permissions](https://firebase.google.com/docs/cloud-messaging/android/get-started)
- [Apple String Catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog) and [XLIFF editing/import workflow](https://developer.apple.com/documentation/xcode/editing-xliff-and-string-catalog-files)
- [Android localization](https://developer.android.com/guide/topics/resources/localization) and [string/plural resources](https://developer.android.com/guide/topics/resources/string-resource)
- [WebRTC TURN connectivity guidance](https://webrtc.org/getting-started/turn-server)
- [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
- [Apple App Review Guidelines, including login services](https://developer.apple.com/app-store/review/guidelines/#login-services)
- [Google Play user data/account deletion requirements](https://support.google.com/googleplay/android-developer/answer/18265346)
