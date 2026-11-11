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
./scripts/download-relief.sh france   # Copernicus GLO-30 elevation tiles of France (133 files, 4.6 GB, not committed); no argument: the Clermont-Ferrand test region (about 85 MB)
npm run build-relief                  # the map's hillshade tiles, built from those (the test region: 20 MB, a minute; France: about 1.8 GB, about an hour; needs the pmtiles CLI or Docker)
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

### Planning a route

Click the map to set the start, then the end; further clicks add waypoints just before the end. Drag a marker to move a point (right-click removes it, and so does the × in the panel). Pick a profile (road, gravel, trail) and 1 to 3 alternatives: the route is recomputed through `POST /route` after a short pause, the selected one is drawn in blue and the others in grey (click one to select it). It needs the API, BRouter with the segment for the region, and PostgreSQL is not required for routing. A point outside the covered area gives a translated "no route" message.

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

## Changing the API

1. Describe the route with TypeBox schemas in `apps/api/src/app/routes`.
2. Run `npm run generate-client`, and commit `packages/api-client`.
3. Use the typed client in the web app through `API_CLIENT` (`apps/web/src/app/core/api`).

## Routing provider

`apps/api/src/routing/routing-provider.ts` defines `RoutingProvider.route(points, profile, avoidZones, alternatives)`. `BRouterProvider` implements it over BRouter's HTTP server. `POST /route` exposes it: points, profile (`road`, `gravel`, `trail`), optional avoid zones and 1 to 4 alternatives. Errors carry a stable `code` (`invalid_request` 400, `no_route` 422, `provider_error` 502, `unavailable` 503) that the web app translates. The endpoint has its own rate limit (`ROUTE_RATE_LIMIT_MAX`, 120 a minute by default: dragging a point on the map asks for a short stretch up to 100 times a minute).

Tests against a real BRouter are opt-in: `docker compose up -d brouter`, then `BROUTER_INTEGRATION=1 npx nx test api -- integration`.

## Principles

- **Open:** AGPL code, open data first (OpenStreetMap, Copernicus, IGN).
- **Local first:** routes are stored on the device.
- **Saved routes:** the _Save_ button keeps the planned route in the browser's IndexedDB (name, profile, points, chosen itinerary, distance, climb, duration). Saved routes are listed in the planner panel and reopen without network or recomputation. Clearing site data deletes them; private windows may refuse storage, in which case the app says so and keeps working. Each saved route can be exported as a GPX file, generated in the browser from the stored geometry.
- **Sharing without an account:** a saved route can be shared by link (`/p/{id}`). The link opens the route in the web app, and `/p/{id}.gpx` downloads it. Shared routes cannot be edited; _Stop sharing_ (or deleting the route) removes them from the server. Sharing is always your choice: a route stays on the device until you share it.
- **GPX import:** _Import a GPX file_ (planner panel) reads a track (`<trk>`, or a route `<rte>` when there is none) on the device, saves it as a route and shows it, with no network call. Files over 10 MB are refused and tracks over 5000 points are thinned out. The routing profile is the one currently selected, and the duration is an estimate from the distance. Without elevation in the file, the climb stays unknown: no elevation profile, no sharing, and the exported GPX has no `<ele>`.
- **Relief service:** `POST /elevation` gives the ground elevation of up to 5000 points, read locally from Copernicus GLO-30 GeoTIFF tiles in `data/relief` (`RELIEF_DIR`; `./scripts/download-relief.sh france` for all of France, default tiles `N45E002 N45E003`; single squares: `./scripts/download-relief.sh N46E005`). Points outside the downloaded tiles answer `null`. It is only used when the user asks to compute the climb of an imported route without elevation: that sends the track's positions to the server. Source to credit: Copernicus DEM GLO-30, provided under COPERNICUS by the European Union and ESA.
- **Elevation profile:** under the map, a collapsible chart of the selected route's elevation. Hover it (or use the arrow keys, Home and End once focused) to see distance, elevation and grade, with a matching dot on the map; hovering the route on the map moves the cursor on the chart.
- **Offline:** the production build is a PWA (service worker and manifest). _Download the map for offline use_ stores the region's PMTiles archive, glyphs and sprites on the device; with it, a saved route opens with no network and no server at all. Try it with `npm run serve:prod` (a small static server with the `index.html` fallback that client-side routes such as `/p/...` need; a real host needs the same rule) (a small static server with the `index.html` fallback that client-side routes such as `/p/...` need; a real host needs the same rule), then switch the servers off (the service worker does not run under `npm run dev`).
- **Bilingual, English first:** no hard-coded UI string; everything goes through translation keys (`en.json` first, then `fr.json`). Numbers, dates and units go through `Intl` and a formatting layer (metric by default).
- **Replaceable components:** routing, geocoding, tiles and relief sit behind interfaces.
- **No secret in the repository:** configuration comes from environment variables (see `.env.example`).

## License

[AGPL-3.0-only](LICENSE).
