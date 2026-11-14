# Contributing to Voie Libre

Thank you for looking at the code. Voie Libre is a route planner for road cycling, gravel and trail running, open source under [AGPL-3.0](LICENSE). Its only user so far is its author, so the project moves in small steps and every change is explained in `docs/`.

## Ways to help

- **Report a problem or suggest an idea:** [open an issue](https://github.com/sroucheray/voie-libre/issues). A route that goes where it should not (with the start, the end, the profile and the app version shown in the About window) is the most useful report.
- **Improve the code or the docs:** open a pull request. For anything bigger than a small fix, open an issue first so that the idea can be discussed before the work is done.
- **Support the project:** [Liberapay](https://liberapay.com/sroucheray).

## How the project is documented

- [docs/features](docs/features/README.md): one file per feature. It holds the brief (why it exists, what done looks like, what is out of scope) and, once the work is done, how it went. A feature that is still open has a `## Plan` section. Read the brief before changing a feature, and write one before starting a new one.
- [docs/implementation.md](docs/implementation.md): the detail of each area of the code, kept in step with it.
- [docs/architecture.md](docs/architecture.md): the choices behind the stack, and what was left out.
- [CLAUDE.md](CLAUDE.md): a one-line summary of each area and the project rules, written for Claude Code but useful as a map of the code.

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
./scripts/download-relief.sh france   # Copernicus GLO-30 elevation tiles of France (133 files, 4.6 GB, not committed); no argument: the Clermont-Ferrand test region (about 85 MB)
npm run build-relief                  # OPTIONAL: only with RELIEF_SOURCE_KIND = 'local' (by default the map uses the public AWS terrain tiles); the map's hillshade tiles, built from those (the test region: 20 MB, a minute; France: about 1.8 GB, about an hour; needs the pmtiles CLI or Docker)
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

BRouter listens on http://localhost:17777. The segment `E0_N45` covers Clermont-Ferrand (lon 0-5, lat 45-50); other regions need other tiles (`./scripts/download-segments.sh france` fetches the seven that cover all of metropolitan France, about 850 MB): `./scripts/download-segments.sh E5_N45`.

### Basemap

The map reads a PMTiles extract of OpenStreetMap data (Protomaps) plus fonts and sprites, all served locally by the `tiles` service on http://localhost:8081, so the map makes no request to an external domain. `./scripts/download-basemap.sh` writes them to `data/basemap` (not committed): it extracts France (`-5.5,41.2,9.8,51.2`, about 4.7 GB) up to zoom 14 into `basemap.pmtiles` from the latest Protomaps planet build, downloading only the needed byte ranges (the `pmtiles` CLI is used if installed, otherwise its Docker image). Override with `BASEMAP_BBOX` (Angers to Lyon is 680 MB, Clermont-Ferrand alone 42 MB), `BASEMAP_MAXZOOM` or `BASEMAP_BUILD`. The app never copies the whole file: users keep the areas they need offline (the corridor of a route, or the view). The map needs a browser with WebGL2; without it the app shows a message instead of the map.

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

## Tests

While you work, run only the tests of the project and the file you changed, for example:

```bash
npx nx test api -- brouter
npx nx test web --include='**/app.spec.ts'
```

Run the whole suite once at the end (`npm test`): it is heavy, so there is no need to run it after each edit. CI runs lint, build and all the tests, and fails if regenerating the API client leaves a diff. Tests against a real BRouter are opt-in (see below).

### Before you push

`scripts/ci-local.sh` runs on your machine the steps of the CI job, in the same order: lint, build, tests, then regenerating the API client must leave no diff. It starts from nothing (no Nx cache, `CI=true`, the database and BRouter integration tests skipped), refuses to run on a dirty working tree so that what is checked is what is pushed, and runs at low priority, one task at a time (about a minute). A hook runs it before a push of `main` or of a `v*` tag; a push that only changes `docs/` or `*.md` goes through. Turn the hook on once:

```bash
git config core.hooksPath .githooks
```

`git push --no-verify` skips it once (CI will run the same checks). What stays different from CI: the machine, which is slower and busier there, and Node (CI uses 24). The unit tests share one environment (`isolate: false`), so `apps/web/src/test-setup.ts` empties `localStorage` before each test: a spec that sets the language no longer reaches the ones after it.

## Rules of the code

- **Code, comments, commits, docs and README are in English.** The app is in English by default, with a French translation.
- **No hard-coded UI string.** Every label goes through translation keys in `apps/web/public/i18n/en.json` first, then `fr.json`; a test fails when a key is missing in one of them. Numbers, dates and units go through the `Intl`-based formatting layer (metric by default).
- **No secret in the repository.** Configuration comes from environment variables; `.env.example` lists them all, with development defaults only. The server's address and keys never go in the repository.
- **The API returns stable error codes**, which the web app translates. Requests and responses are validated with schemas.
- **External components sit behind interfaces:** routing, geocoding, tiles and relief can be replaced.
- **Local first:** routes live on the device, and sending anything to the server is always the user's choice.
- **Small verified steps:** one commit per step, with a conventional message (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), after lint, build and the targeted tests pass.
- **Documentation moves with the code:** when a feature changes, update its section in `docs/implementation.md` and its brief.

## Changing the API

1. Describe the route with TypeBox schemas in `apps/api/src/app/routes`.
2. Run `npm run generate-client`, and commit `packages/api-client`.
3. Use the typed client in the web app through `API_CLIENT` (`apps/web/src/app/core/api`).

## Routing provider

`apps/api/src/routing/routing-provider.ts` defines `RoutingProvider.route(points, profile, avoidZones, alternatives)`. `BRouterProvider` implements it over BRouter's HTTP server. `POST /route` exposes it: points, profile (`road`, `gravel`, `trail`), optional avoid zones and 1 to 4 alternatives. Errors carry a stable `code` (`invalid_request` 400, `no_route` 422, `provider_error` 502, `unavailable` 503) that the web app translates. The endpoint has its own rate limit (`ROUTE_RATE_LIMIT_MAX`, 120 a minute by default: dragging a point on the map asks for a short stretch up to 100 times a minute).

Tests against a real BRouter are opt-in: `docker compose up -d brouter`, then `BROUTER_INTEGRATION=1 npx nx test api -- integration`.

## Releases and production

The app runs at https://voielibre.app on a small VPS, with Docker Compose behind Caddy (HTTPS, one origin: the web app, `/api` and `/tiles`). Only Caddy publishes ports; PostgreSQL, BRouter, the tiles server and the API stay inside the Compose network.

- [docker-compose.prod.yml](docker-compose.prod.yml), [docker/caddy/Caddyfile](docker/caddy/Caddyfile) and [.env.production.example](.env.production.example) describe the stack; nothing secret is in the repository.
- A version is a tag `vX.Y.Z` on `main`. `.github/workflows/deploy.yml` runs lint, build and tests for it, then builds the images (`ghcr.io`) and deploys them to the server over SSH; if the tests fail, nothing is deployed. `scripts/deploy.sh` does the same by hand from a developer's machine. The version shown in the About window is the tag.
- [docs/features/deploy.md](docs/features/deploy.md) tells the choices, the steps and what the first deployment taught.

## License

By contributing you agree that your contribution is released under the [AGPL-3.0-only](LICENSE) licence of the project.
