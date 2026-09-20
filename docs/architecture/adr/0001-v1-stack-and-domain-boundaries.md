# ADR-0001: v1 stack lock and domain boundaries

- Status: Accepted
- Date: 2026-02-26

## Context

The original v1 scope defined the following boundaries; the [current roadmap](https://git.subcult.tv/subculture-collective/patchwork/issues/10) now tracks delivery:

- Frontend: Vite + React + TypeScript + Tailwind CSS
- Backend/services: TypeScript (Node.js)

Phase 1 requires runnable shells, shared env/config validation, quality gates, and explicit domain boundaries.

## Decision

1. Use a single-language TypeScript stack across frontend + backend services for v1.
2. Structure repository by executable boundaries:
    - `apps/web`
    - `services/api`
    - `services/indexer`
    - `services/moderation-worker`
    - `packages/shared`
3. Place shared env/config schema + cross-service contract stubs in `packages/shared`.
4. Enforce baseline quality gates via workspace scripts and GitHub Actions CI.

## Consequences

- Faster iteration with shared typing and lower integration overhead.
- Clear seam for future optimization or service extraction.
- Contract-first development enabled before feature-complete implementation.
