# ADR-0005: Separate native iOS and Android applications

- Status: Accepted architecture direction; implementation not started
- Date: 2026-11-15
- Decision source: product-owner interview in this workspace
- Supersedes: [ADR-0002](0002-mobile-architecture.md)
- Delivery plan: [Native mobile first release](../../superpowers/plans/2026-11-15-native-mobile-apps.md)
- Delivery tracker: [GitHub roadmap #210](https://github.com/subculture-collective/patchwork/issues/210)

## Context

The product owner explicitly selected Swift with SwiftUI for iOS and Kotlin
with Jetpack Compose for Android. Both apps retain Patchwork's brand and use
platform-native navigation, controls and interactions. The first delivery is
installable private test builds; store releases follow separately.

`apps/mobile` contains TypeScript scaffolding, not an installable app. Its chat
and push routes do not match the current API, push registration is simulated,
and offline processing marks actions synced without sending them. It is an
input to review, not a client implementation to translate mechanically.

## Decision

1. Build independent applications under `apps/ios` and `apps/android` in this
   repository. Do not add React Native, Flutter, a WebView application shell,
   or a shared Kotlin Multiplatform runtime.
2. Keep the existing Patchwork API, AT Protocol identity, authorization and
   domain rules authoritative. Share language-neutral wire contracts and test
   fixtures; implement client models, storage and interfaces in Swift and Kotlin.
3. Keep AT OAuth credentials on the server for the first release. Add a bounded
   native login handoff into the existing Patchwork session model. The apps
   receive Patchwork sessions, not PDS access/refresh tokens. Validate this
   design in the first integration milestone.
4. Deliver member discovery, requests/offers, profiles, safety, notifications,
   inbox/outcomes, scheduling, groups, group chat and live exact-location
   exchange. Organization administration remains on the web initially.
5. Offline support covers recently loaded public discovery and local
   request/offer drafts. Sending, accepting, chat and every shared-state
   mutation require a connection. There is no automatic offline outbox.
6. Preserve the ZIP/county publication model and approved-public-address
   boundary. Exact personal coordinates belong only in an authorized,
   encrypted, ephemeral exchange between accepted connection participants.
7. Add APNs and FCM delivery through the durable notification system. Browser
   push remains its own supported transport.
8. Retire the obsolete TypeScript mobile scaffold during implementation after
   auditing its consumers. This decision does not remove it or change runtime
   behavior.
9. Make localization a first-release requirement, as explicitly requested by
   the owner after the scope interview. Use native iOS String Catalogs and
   Android string/plural resources, stable semantic message identifiers and
   documented translator export/import. New supported languages should require
   translation resources and locale registration rather than screen rewrites.
   Reuse reviewed web translations where meaning and context match, with
   explicit conversion of interpolation and plural rules.

## Consequences

Two clients need separate implementations, platform checks and release
artifacts. Shared server fixtures and end-to-end scenarios must detect drift
between their behavior. Native app completion does not establish public-service
launch approval or replace the existing pilot qualification contract.

The first release includes groups and exact-location exchange by explicit
owner choice. They are acceptance requirements, not optional stretch goals.
Connectivity, privacy and cross-client interoperability for exact exchange
must be proved early rather than left until store submission.

Phone-first layouts, English/Spanish, foreground-only exact exchange and
retention limits for local caches/drafts are implementation recommendations
recorded in the plan. They were not separate owner interview decisions.
Localization support itself is an explicit owner requirement; English/Spanish
is the proposed initial language set based on the existing product.
