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
    10c. **Relief service** (added, done). `ElevationProvider` interface in the API and an endpoint that returns elevations for points; used by the import's "compute climb" choice.
11. **Wrap-up** (done). Full test run once, README quick start, update `docs/architecture.md` if anything diverged.

## Open points

- Confirm the assumption that alternatives belong to phase 1.
- Shared routes: immutable, delete token (hashed), a single `shared_routes` table (PostGIS line), strict write limits. QR code: not done yet (needs a library, permission to install pending).
- Left for later (known at the end of milestone 1): the QR code for the share link (needs a library, permission pending); CI never ran on GitHub; real-file import tests (Komoot, Garmin, RideWithGPS); credits of routes saved before the credits existed are missing (their stored `elevationSource` is absent), and shared copies do not carry the source; after an app update the service worker serves the previous version once; a "new version available" bar now offers the reload (checked by hand: old page, bar shown, reload gives the new version); production hosting must answer `index.html` for any path that is not a file (`scripts/serve-static.mjs` does it locally).
- Checked at the end of milestone 1: the exported GPX opens in GDAL's GPX driver (`ogrinfo`) with the right waypoints, one track and every point with its elevation; the production build serves with a working service worker, the `/p/...` fallback, and glyphs and sprites cached from any host (`ngsw-config.json` no longer hardcodes the tiles host); when the network cannot carry a request the service worker answers 504, which the app now maps to its "network/unavailable" messages.

## Backlog (noted 2026-11-08, done 2026-11-09)

Brief: `BRIEF-backlog.md`. One commit per item. Decisions taken: stops are search fields like Start and End; "My position" is the first suggestion of an empty field; the direction applies to loops by distance only; grade colours on the profile only; a drag is cancelled by Escape, and undone by Ctrl/Cmd+Z after the drop.

- **Bug: three alternatives return nothing** (done, `2cc18d9`). BRouter runs 2 requests at once and kills a running one when a third arrives; the API sent its alternatives together. Calls now wait in the provider (`BROUTER_MAX_CONCURRENT`), and a missing alternative is left out instead of failing the request.
- **Bug: map tiles not always refreshed after moving the map** (done, `fe18c52`). MapLibre does not retry a tile in error while it stays on screen; `retryFailedTiles` does, after a delay and when the map stops moving.
- **Stops by address** (done, `eabf455`). Each stop is a search field; "Add a stop" opens an empty one before the end.
- **My position in the fields** (done, `b22e391`). First choice of an empty Start, End or stop field.
- **Preferred direction for a loop by distance** (done, `2623b3d`). `loop.direction`, 8 compass points or none.
- **Stretch of the elevation profile, grade colours** (done, `f837450`). Distance, ascent, descent and average grade of the selection, highlighted on the map.
- **Live drag** (done, `fb498a4`). The route follows a dragged marker or a waypoint pulled out of the route; Escape cancels, one undo step after the drop.

Checked in a browser against the local stack: the three alternatives on the Clermont-Ferrand to Pavezin trip, the tiles after a failed load, the profile selection and its highlight, the live drag (marker and route line, Escape, drop, Ctrl+Z). Not checked: touch screens (a drag cannot be cancelled there other than by the undo button), Cmd+Z on macOS.

## Asked 2026-11-10 (not started)

Brief: `BRIEF-reverse-fit-snap.md`, plan: `PLAN-reverse-fit-snap.md`. Reverse the whole route, removal recomputed between the two neighbours, FIT export, points on ways for Road and Gravel, map layer proposals (document only).

Seen on the way, left as they are (backlog of 2026-11-08):

- The basemap extract covers longitude 2.6 to 3.7 and latitude 45.3 to 46.1 only: the map is grey beyond (the end of the Pavezin trip, for instance), while BRouter routes there.
- Three alternatives on that long trip take about 27 s to compute, now that the calls are queued.
- During a drag the web app can send up to 100 `POST /route` a minute, each for a short stretch; the default limit went from 20 to 120 a minute.
