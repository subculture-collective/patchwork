# Patchwork

![Patchwork: A little help, from a friend. Four stitched neighborhood patches.](docs/assets/readme/banner.png)

Someone two streets over needs a ride on Thursday. You have a car on Thursday.
Patchwork is where neighbors ask for help like that and offer it. It also keeps
a map and directory of food banks, clinics, shelters and other local services.

Patchwork is a pre-alpha demonstration. Please don't arrange real help through
it yet. It is not an emergency service and cannot promise that anyone will
answer a request.

Live demo: [patchwork.subcult.tv](https://patchwork.subcult.tv)

## Features

- **Requests and offers.** Sign in with an AT Protocol account (a Bluesky
  account works) to ask for help, offer help on someone's request, or post an
  offer of your own. Neighbors ask for an offer and the poster picks one.
- **Map, feed and resource directory.** Browse requests, offers and resource
  listings without an account. Requests show an approximate area; approved
  public resources can show their address.
- **Inbox and outcomes.** Accepted offers and asks continue in an inbox where
  both sides can record how it went.
- **Scheduling, groups and chat.** People with an accepted connection can agree
  on a time and message each other. Groups take join requests and share rooms.
  Chat is readable by the server.
- **Organizations and verification.** Organizations keep profiles and resource
  records. Listings can be reported, corrected and verified.
- **Volunteer profiles** with an approximate service area.
- **Notifications** in the app, by email and by web push.
- **Moderation.** Reports go to a moderation queue with a separate worker
  service.
- **Account settings** with data export and deactivation.
- **Optional donations.** General-fund giving with Stripe Checkout and gifts to
  verified organizations through Stripe Connect. Payments are off unless
  configured.
- English and Spanish interface.

Patchwork uses [AT Protocol](https://atproto.com) for accounts and public
records. Resource listings are attributed to their source and do not imply that
an organization takes part, endorses Patchwork or is currently available.

## Quick start

You need Node.js 22.15 or later, npm and Docker (for local PostgreSQL).

```sh
npm ci
cp .env.example .env
# in .env: set ATPROTO_SESSION_ENCRYPTION_KEY (openssl rand -base64 32),
# API_DATA_SOURCE=postgres and
# API_DATABASE_URL=postgresql://patchwork:patchwork@localhost:5432/patchwork
npm run db:up
export DATABASE_URL=postgresql://patchwork:patchwork@localhost:5432/patchwork
npm run db:migrate                                   # API tables
npm run db:migrate -w @patchwork/indexer             # projection tables
npm run db:migrate -w @patchwork/moderation-worker   # moderation tables
npm run db:seed        # optional sample data
npm run dev:api        # API on http://localhost:4000
npm run dev:web        # web app on http://localhost:5173
```

The API refuses to start until the indexer tables exist. The indexer and
moderation worker run with `npm run dev:indexer` and `npm run dev:moderation`.
See [DEVELOPMENT.md](DEVELOPMENT.md) for the full local setup, datasource modes
and API routes.

Tests and checks:

```sh
npm run lint
npm run typecheck
npm run test                                       # unit tests
npm run test:integration:postgres                  # PostgreSQL + HTTP tests
npm run test:e2e -w @patchwork/web                 # Playwright browser tests
npm run check                                      # lint, typecheck, tests
```

The Makefile wraps the same commands (`make install`, `make dev`, `make check`).

## Configuration

Copy `.env.example` to `.env`. The main groups of settings are:

- **AT Protocol:** `ATPROTO_OAUTH_CLIENT_ID`, `ATPROTO_OAUTH_REDIRECT_URI`,
  `ATPROTO_SESSION_ENCRYPTION_KEY`, `ATPROTO_PDS_URL`,
  `ATPROTO_ACCOUNT_PDS_URL`, `ATPROTO_SERVICE_DID`.
- **API:** `API_DATA_SOURCE` (`postgres`), `API_DATABASE_URL`, `API_PORT`,
  `API_PUBLIC_ORIGIN`, `API_TRUSTED_PROXIES`.
- **Indexer:** `INDEXER_FIREHOSE_URL`, `INDEXER_JETSTREAM_VERSION`,
  `INDEXER_PROJECTION_MODE`.
- **Moderation worker:** `MODERATION_PORT`, `MODERATION_WORKER_CONCURRENCY`.
- **Attachments:** S3-compatible object storage (`ATTACHMENT_OBJECT_*`), a
  signing key and a ClamAV scanner (`ATTACHMENT_CLAMD_HOST`,
  `ATTACHMENT_CLAMD_PORT`).
- **Notifications:** email provider (`NOTIFICATION_EMAIL_*`) and web push keys
  (`NOTIFICATION_VAPID_*`).
- **Payments:** `PATCHWORK_PAYMENTS_MODE` (default `off`), `STRIPE_*` and
  `PATCHWORK_GENERAL_FUND_*`.
- **Web app:** `VITE_API_BASE_URL`, `VITE_MAP_TILE_URL`.

## Deploy

`docker-compose.yml` runs the production stack: the web app (nginx serving the
Vite build), the API, the indexer, the moderation worker and PostgreSQL. It
expects an external Docker network named `web` with a reverse proxy in front of
it. The Makefile has targets for it:

```sh
make compose-config   # validate the Compose file
make deploy-up        # build and start
make deploy-db-migrate
make deploy-logs
```

Map tiles are served from a PMTiles file (`PATCHWORK_PM_TILES_*`). The API,
indexer and moderation worker expose `/metrics`, and Prometheus rules are in
`monitoring/prometheus/`.

## Project layout

- `apps/web`: React, Vite and Tailwind web app
- `apps/mobile`: mobile client library (API client, navigation, push); there is no mobile app yet
- `services/api`: HTTP API, AT Protocol OAuth, chat and scheduling
- `services/indexer`: ingestion and indexing of AT Protocol records
- `services/moderation-worker`: moderation queue worker
- `packages/shared`: shared contracts, config schemas and utilities
- `packages/at-lexicons`: lexicon schemas, fixtures and validators
- `packages/at-client`: AT Protocol OAuth and repository client
- `docs/`: architecture, protocol and product notes

## Contributing

Report bugs and request features in [GitHub issues](https://github.com/subculture-collective/patchwork/issues).
Ask questions and share ideas in [GitHub Discussions](https://github.com/subculture-collective/patchwork/discussions).

Send code as a pull request on GitHub against `main`. CI runs lint, type checks, unit
and PostgreSQL integration tests, Playwright browser tests, a dependency audit
and a production build on every pull request. Geoprivacy and moderation
regressions block a merge.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

Built by [SUBCULT](https://subcult.tv).
