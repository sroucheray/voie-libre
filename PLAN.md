# Plan — milestone 1 (foundation)

Each step ends with the project starting and its tests passing. Targeted tests during a step; one full run at the end.

1. **Repo skeleton.** Nx workspace, `apps/web` (Angular, strict), `apps/api` (Fastify), shared lib for types. AGPL `LICENSE`, `README.md`, `.env.example`, `.gitignore`. Check: both apps build and start; empty test suites run.
2. **i18n and formatting.** Transloco with `en.json` then `fr.json`, language switch, formatting service on `Intl` (distance, elevation, dates; metric). Check: unit tests for the formatter; a missing-key check between `en.json` and `fr.json`.
3. **Dev infrastructure.** `docker-compose.yml` with BRouter (segment `E0_N45` for the Clermont-Ferrand test region, downloaded by a script, not committed; start from `spike/brouter/start.sh`, 512 MiB container) and PostGIS. Check: `GET /brouter` answers a route between two points. The spike showed `avoid` zones and alternatives work (see `spike/brouter/RAPPORT.md`).
4. **Routing provider interface (API).** `RoutingProvider` interface and BRouter adapter (points, profile, alternatives to geometry + distance, ascent, duration). `POST /route` with Fastify schemas. Check: adapter unit tests against recorded BRouter responses; one integration test against local BRouter.
5. **OpenAPI and generated client.** `@fastify/swagger` spec, generation of the TypeScript client into the shared lib, wired into the web app. Check: regenerating the client leaves no diff.
6. **Map and planner.** MapLibre component (PMTiles source), click to set start, end and waypoints, profile selector (road, gravel, trail), route drawn from `POST /route`, alternatives shown. All labels through Transloco. Check: component tests for planner state; manual check in the browser.
7. **Local storage.** `RouteStore` interface with an IndexedDB implementation: save, list, open, delete. Short ids (8–10 random chars). Check: unit tests with a fake IndexedDB.
8. **GPX export.** Generate GPX from stored geometry on the device and download it. Check: unit tests on output; validate in a GPX viewer.
9. **Offline.** Service worker and PWA manifest, offline PMTiles extract for the test region, open a saved route with no network. Check: manual offline test (devtools network off).
10. **Sharing without account.** `PUT /p/{id}`, `GET /p/{id}`, `GET /p/{id}.gpx`; link and QR code on the web app. Check: API tests; open a shared link in a second browser profile.
    10a. **Elevation profile** (added). Chart of distance against elevation under the map, from the selected route's stored geometry; hovering it (or arrow keys) moves a dot on the map, hovering the route on the map moves the cursor on the chart; collapsible; grade in the tooltip, no colouring yet. Check: unit tests; manual check on a saved route.
    10b. **GPX import** (added, done). `<trk>` first, `<rte>` as a fallback; saved as a local route without calling `POST /route`; no elevation → imported with an unknown climb (profile hidden, sharing disabled); the "compute the climb?" question comes with 10c, once the relief service exists.
    10c. **Relief service** (added, after the import). `ElevationProvider` interface in the API and an endpoint that returns elevations for points; used by the import's "compute climb" choice.
11. **Wrap-up.** Full test run once, README quick start, update `docs/architecture.md` if anything diverged.

## Open points

- Confirm the assumption that alternatives belong to phase 1.
- Shared routes: immutable, delete token (hashed), a single `shared_routes` table (PostGIS line), strict write limits. QR code: not done yet (needs a library, permission to install pending).
