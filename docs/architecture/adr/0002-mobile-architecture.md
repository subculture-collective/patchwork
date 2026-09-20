# ADR-0002: Mobile client architecture

- Status: Accepted
- Date: 2026-03-02

## Context

Native delivery is deferred in the current program. [Issue #60](https://git.subcult.tv/subculture-collective/patchwork/issues/60) tracks completion of the existing scaffolding and reconciliation of this earlier architecture decision; [issue #61](https://git.subcult.tv/subculture-collective/patchwork/issues/61) tracks beta/store qualification.
The platform already has a web client (`apps/web`) consuming shared TypeScript contracts
from `packages/shared`. A mobile strategy must be chosen that maximizes code sharing while
delivering native performance.

## Decision

1. Use **React Native** with the shared TypeScript contract package (`@patchwork/shared`).
2. Structure the mobile workspace at `apps/mobile` mirroring the existing `apps/web` pattern.
3. Consume the same shared API contracts, offline-sync primitives, and notification types
   used by the web client. Mobile-specific contracts live in `packages/shared/src/mobile.ts`.
4. Mobile API client (`apps/mobile/src/api-client.ts`) mirrors the web API client pattern
   but adds device-info headers, connectivity-aware gating, and auth token injection.
5. Navigation model maps core mobile flows to a tab-based structure with deep link support.
6. Push notifications integrate with the shared `NotificationType` contracts.
7. Offline sync wraps the shared `SyncQueue` with mobile-specific concerns (connectivity,
   background sync, offline duration enforcement).

## Rationale

- **Maximum code sharing**: Single `@patchwork/shared` contract package used by web, mobile,
  and backend services eliminates contract drift.
- **React Native**: Aligns with the existing React + TypeScript web stack; team already has
  TypeScript expertise. Single codebase for iOS and Android.
- **Contract-first**: Mobile clients are verified against the same contract stubs and test
  fixtures as the web client, ensuring API compatibility.
- **Offline-first**: Mobile users in mutual aid scenarios often have intermittent connectivity.
  The shared `SyncQueue` + mobile wrapper ensures actions are never lost.

## Consequences

- `@patchwork/shared` gains mobile-specific exports (types, QA contracts, release checklist).
- `apps/mobile` workspace is registered in the monorepo workspaces glob.
- Mobile QA matrix and release checklist are tracked as operational documents.
- Future native module integrations (maps, camera) will require platform-specific bridges.
- App store submission requires ongoing compliance with Apple and Google review guidelines.
