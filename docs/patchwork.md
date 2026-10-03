# Patchwork

**Mutual aid, block by block.**

Patchwork is mutual aid coordination software built on the AT Protocol.
Neighbors post requests, offer help, and look up local organisations and
services.

> Status: pre-alpha demonstration. Patchwork is not approved to operate as a
> public mutual-aid service, and nobody should arrange real help through it
> yet. The [README](../README.md) and the
> [implementation inventory](architecture/current-state-matrix.md) describe
> what currently works. Where this overview and the inventory disagree, the
> inventory is right.

---

## What Patchwork Is

Patchwork provides tools for:

- **Posting aid requests** -- Describe what you need, categorise it, and share
  it with your community.
- **Offering help** -- Browse nearby requests, volunteer your time or
  resources, and coordinate responses.
- **Discovering needs** -- Map-based and feed-based discovery with filters for
  category, urgency, distance, and status.
- **Coordinating volunteers** -- Onboarding, verification tiers, and profile
  management for volunteers and organisations.
- **Community resources** -- A shared directory of local resources, services,
  and partner organisations.
- **Messaging** -- Chat between people with an accepted connection, and in
  group rooms. Messages are server-readable and are not end-to-end encrypted.
- **Feedback and outcomes** -- A structured report after a handoff.

Patchwork is **not** a charity, a professional services provider, or an
emergency service. It cannot guarantee a match, a response or fulfillment.

## How It Works

### AT Protocol Federation

Patchwork is built on the [AT Protocol](https://atproto.com/), a federated
social networking protocol. This means:

- **Your identity is portable.** Your account is a Decentralized Identifier
  (DID) that you control, not a username locked to one server.
- **Your data is yours.** Content you create is stored in your personal data
  repository and can move between services.
- **The network is open.** Other services on the AT Protocol network can
  interoperate with Patchwork's data formats (Lexicon schemas).
- **No single point of control.** Federation distributes power across the
  network rather than concentrating it.

### Key Features

| Feature                  | Description                                    |
| ------------------------ | ---------------------------------------------- |
| Map discovery            | Clustered, approximate-area discovery with quick triage |
| Feed                     | Nearby request stream with lifecycle actions    |
| Resource directory       | Directory overlays and partner resources        |
| Volunteer management     | Onboarding, verification, and profiles          |
| Chat                     | Server-readable text chat for connections and group rooms |
| Moderation               | Queue-based triage with graduated enforcement   |
| Inbox                    | Unified inbox for requests, assignments, and alerts |
| Feedback                 | Post-handoff outcome reporting                  |
| Offline behaviour        | Shows an offline notice; changes are not queued while offline |
| Privacy controls         | Approximate public areas, visibility settings, and data export |

## Architecture Overview

Patchwork is a monorepo with the following components:

| Component                   | Package / Service               | Role                                        |
| --------------------------- | ------------------------------- | ------------------------------------------- |
| **Patchwork Web**           | `apps/web`                      | Client application (React, TypeScript)       |
| **Patchwork API**           | `services/api`                  | Query, auth, and coordination API            |
| **Spool** (Indexer)         | `services/indexer`              | AT Protocol firehose ingestion and indexing  |
| **Thimble** (Mod Worker)    | `services/moderation-worker`    | Moderation queue processing and policy engine|
| **Shared**                  | `packages/shared`               | Shared types, schemas, and utilities         |
| **AT Lexicons**             | `packages/at-lexicons`          | AT Protocol Lexicon schema definitions       |

### Service Boundaries

- **API** handles authenticated requests, lifecycle actions, and query routing.
- **Indexer** subscribes to the AT Protocol firehose, validates records, and
  maintains the discovery index.
- **Moderation Worker** processes the moderation queue, applies policy actions,
  and maintains the audit trail.
- **Web** is the primary client, rendering map, feed, directory, and settings
  views.

For detailed architecture documentation, see `docs/architecture/`.

## Naming System

A coherent set used across repos, services, workers, and docs:

* **Patchwork Web** -- the client (`patchwork-web`)
* **Patchwork API** -- query + auth (`patchwork-api`)
* **Spool** -- ingestion + queueing ("spool" = feed intake) (`patchwork-spool`)
* **Quilt** -- indexing + search layer ("quilting" = assembling meaning) (`patchwork-quilt`)
* **Stitch** -- chat service (`patchwork-stitch`)
* **Thimble** -- moderation worker (small tool, sharp purpose) (`patchwork-thimble`)

The whole platform is legible through the metaphor: *patches* (needs/offers),
*threads* (conversations), *stitches* (links/verification), *quilt*
(index/overview), *thimble* (moderation tool).

## Taglines

In use in the app:

* Tagline: "Mutual aid, block by block"
* Home headline: "A little help, from a friend."

Earlier candidates, not in use: "Mutual aid, woven."; "Requests in. Care
out."; "A commons for need, offer, and coordination."; "Community
infrastructure for getting through it."

## Voice

Patchwork copy reads like a note on a community board from a neighbor who has
done this before and is not in a hurry. It uses full sentences and small,
ordinary examples: a ride to an appointment, a spare crib, a meal.

* Say "you" and "your neighbors". The app uses the American spelling.
* State the location rule exactly: requests show an approximate area; approved
  public resources can show their address.
* Keep the pre-alpha, demonstration and not-an-emergency-service notices in
  every rewrite. Never promise that help will come.
* Avoid hero language, urgency and crisis imagery. Keep protocol and internal
  terms (PDS, DID, AT identity, NO-GO, deferred, API sync) out of public copy.
* Interface labels and errors stay plain. An error says what happened and what
  to do next.
* English and Spanish carry the same meaning. Write the Spanish as a neighbor
  would say it, not word for word.

## Branding

* Icon idea: a **single irregular patch** with 2--3 visible stitches (simple, scalable)
* Motif: **visible seams** = transparency, accountability, and "no magic black box moderation"

## Namespace / API Flavour

* Domain-ish IDs: `patchwork/*`, `pw/*`, or `app.patchwork/*`
* Endpoints that match the metaphor:

  * `GET /threads` (requests/offers)
  * `GET /patches` (individual items)
  * `GET /bundles` (resource groupings)
  * `GET /signals` (alerts/urgent items)
  * `GET /ledger` (optional transparency log for mod actions)

## Legal and Policy Documents

- [Terms of Service](./legal/terms-of-service.md)
- [Privacy Policy](./legal/privacy-policy.md)
- [Community Guidelines](./legal/community-guidelines.md)
- [Acceptable Use Policy](./legal/acceptable-use-policy.md)
- [Policy Changelog](./legal/changelog.md)

## Operations

- [RACI Matrix](./operations/raci.md)
- [Moderation SOPs](./operations/moderation-sops.md)
- [Verification Appeals](./operations/verification-appeals.md)
- [SLI/SLO Definitions](./operations/sli-slo.md)
- [Alerting Policy](./operations/alerting-policy.md)
- [Secrets Rotation](./operations/secrets-rotation.md)
