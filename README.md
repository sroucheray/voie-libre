# Voie Libre

Open-source route planner for road/gravel cycling and trail running, as a website and an Android app.
Local first: routes live on the device, and sending anything to the server is always the user's choice.

Status: early development (milestone 1, see [BRIEF.md](BRIEF.md) and [PLAN.md](PLAN.md)).
Architecture: [docs/architecture.md](docs/architecture.md). Context for Claude Code: [CLAUDE.md](CLAUDE.md).

## Layout

| Path                  | Content                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web`            | Angular single-page app (no SSR), strict TypeScript, standalone components, signals       |
| `apps/api`            | Node.js + Fastify API (TypeBox schemas, OpenAPI, PostgreSQL migrations, routing provider) |
| `packages/api-client` | TypeScript client generated from the API's OpenAPI document                               |
| `libs/shared`         | Types and code shared by the web app and the API                                          |
| `docker-compose.yml`  | PostgreSQL with PostGIS, BRouter, and (optional) the API                                  |
| `docs/`               | Architecture document and diagrams                                                        |
| `spike/brouter/`      | Finished spike validating BRouter locally (see its `RAPPORT.md`)                          |

## Requirements

- Node.js 24 and npm 11
- Docker with Compose

## Quick start (local)

```bash
git clone <repo-url> voie-libre && cd voie-libre
npm install
cp .env.example .env                  # optional: the defaults already match docker-compose.yml
./scripts/download-segments.sh        # BRouter data for the test region (about 120 MB, not committed)
./scripts/download-basemap.sh         # map tiles, fonts and sprites for the test region (about 55 MB, not committed)
docker compose up -d                  # PostgreSQL/PostGIS, BRouter (first start builds it) and the tiles server
npm run db:migrate                    # enables PostGIS
npm run dev                           # API and web app together
```

| URL                                | What                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| http://localhost:4200              | Web app (it shows the API status)                              |
| http://localhost:3000/docs         | API documentation (Swagger UI)                                 |
| http://localhost:3000/openapi.json | OpenAPI document                                               |
| http://localhost:3000/health       | API and database state (200, or 503 when the database is down) |

BRouter listens on http://localhost:17777. The segment `E0_N45` covers Clermont-Ferrand (lon 0-5, lat 45-50); other regions need other tiles: `./scripts/download-segments.sh E5_N45`.

### Basemap

The map reads a PMTiles extract of OpenStreetMap data (Protomaps) plus fonts and sprites, all served locally by the `tiles` service on http://localhost:8081, so the map makes no request to an external domain. `./scripts/download-basemap.sh` writes them to `data/basemap` (not committed): it extracts the region `2.6,45.3,3.7,46.1` up to zoom 14 from the latest Protomaps planet build, downloading only the needed byte ranges (the `pmtiles` CLI is used if installed, otherwise its Docker image). Override with `BASEMAP_BBOX`, `BASEMAP_MAXZOOM` or `BASEMAP_BUILD`. The map needs a browser with WebGL2; without it the app shows a message instead of the map.

To run the API in a container instead of `npm run dev`, use `docker compose --profile full up -d` and start only the web app (`npx nx serve web`).

## Common commands

```bash
npm run dev               # serve api and web
npm run build             # build every project
npm run lint              # lint every project
npm test                  # run every test suite
npm run generate-client   # regenerate packages/api-client from the API schemas
npm run db:migrate        # apply migrations (db:migrate:down reverts the last one)
```

During development, run only the tests of the project you changed (`npx nx test api`, `npx nx test web`) and the whole suite once at the end. CI (GitHub Actions) runs lint, build and tests, and fails if regenerating the API client leaves a diff.

## Changing the API

1. Describe the route with TypeBox schemas in `apps/api/src/app/routes`.
2. Run `npm run generate-client`, and commit `packages/api-client`.
3. Use the typed client in the web app through `API_CLIENT` (`apps/web/src/app/core/api`).

## Routing provider

`apps/api/src/routing/routing-provider.ts` defines `RoutingProvider.route(points, profile, avoidZones, alternatives)`. `BRouterProvider` implements it over BRouter's HTTP server. `POST /route` exposes it: points, profile (`road`, `gravel`, `trail`), optional avoid zones and 1 to 4 alternatives. Errors carry a stable `code` (`invalid_request` 400, `no_route` 422, `provider_error` 502, `unavailable` 503) that the web app translates. The endpoint has its own, stricter rate limit (`ROUTE_RATE_LIMIT_MAX`).

Tests against a real BRouter are opt-in: `docker compose up -d brouter`, then `BROUTER_INTEGRATION=1 npx nx test api -- integration`.

## Principles

- **Open:** AGPL code, open data first (OpenStreetMap, Copernicus, IGN).
- **Local first:** routes are stored on the device.
- **Bilingual, English first:** no hard-coded UI string; everything goes through translation keys (`en.json` first, then `fr.json`). Numbers, dates and units go through `Intl` and a formatting layer (metric by default).
- **Replaceable components:** routing, geocoding, tiles and relief sit behind interfaces.
- **No secret in the repository:** configuration comes from environment variables (see `.env.example`).

## License

[AGPL-3.0-only](LICENSE).
