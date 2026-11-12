# Voie Libre — Brief

Source of truth for architecture: [docs/architecture.md](../architecture.md). This brief only fixes what the first milestone is.

## What and for whom

Open-source (AGPL) route planner for road/gravel cycling and trail running, as a website and an Android app. At launch the only user is the author; community features come later (phase 4). The author is the sole moderator.

## Stack (fixed)

- Front: Angular SPA (no SSR), strict TypeScript, MapLibre GL JS used directly in a component, Transloco with `en.json` then `fr.json`, Capacitor for Android (later).
- Back: Node.js, Fastify, TypeScript, OpenAPI generated from validation schemas with `@fastify/swagger`; the Angular TypeScript client is generated from that spec.
- Data: PostgreSQL + PostGIS.
- Routing: BRouter (Docker) behind a swappable "routing provider" interface. GraphHopper later, for loops.
- Maps: vector tiles, PMTiles extracts for offline.
- External components (routing, geocoding, tiles, relief) always sit behind interfaces.
- Repository: Nx monorepo.

## Milestone 1 = architecture phase 1 ("foundation")

### Done means

End-to-end flow works, checked by the author:

1. Draw a road-profile route on the map (start, end, waypoints) using BRouter.
2. Save it locally on the device.
3. Reopen it offline (no network, no recomputation).
4. Export a GPX that opens correctly in a GPX viewer.

Also in scope, per the architecture phase 1: gravel/trail profiles, sharing by link or QR code without an account, offline PMTiles basemap for the test region.

### Assumption (to confirm)

Alternatives (BRouter `alternativeidx`) were not excluded, so they are in phase 1. Loops and manual track editing stay in phase 2, as in the architecture document.

### Out of scope for milestone 1

- Accounts, OSM login, cross-device sync.
- Avoid zones and reports (phase 3).
- Android APK (Capacitor packaging comes after the web app works).
- Real-time navigation, on-device routing, social features.

## Verification

- Unit tests for non-trivial logic: GPX generation, units/formatting, routing provider adapter, route storage, short-id generation.
- Every step must leave the project starting and tests passing.
- Garmin check comes later; for now the GPX is validated in a viewer.

## Constraints

- Spare-time project: small steps, no deadline.
- Minimal server budget (small VPS, about 4–6 EUR/month). In development BRouter runs locally in Docker with the segments for the test region; the public brouter.de server is not used for development.
- Test region: Clermont-Ferrand (Auvergne-Rhône-Alpes). It fits in one BRouter segment, `E0_N45` (122 MiB on disk), as confirmed by the spike in `spike/brouter/RAPPORT.md`. Trips leaving lon 0–5° / lat 45–50° need other tiles.
- No Garmin available at the start.
- No secret in the repository (public AGPL repo): everything via environment variables.
- Code, comments, commits, docs and README in English. UI in English by default, French translation, no hard-coded UI string, formatting through `Intl` and a formatting layer (metric by default).

## What already exists

`docs/architecture.md` with its two diagrams under `docs/diagrams/`, this brief, `milestone-1.md#how-it-went`, and a finished spike (`spike/brouter/`) that validated BRouter locally: avoid zones (circle, line, polygon), alternatives, GPX with elevation, and memory needs. No application code yet.

## How it went

Built in 11 steps, one commit each: Repo skeleton; i18n and formatting; Dev infrastructure; Routing provider interface (API); OpenAPI and generated client; Map and planner; Local storage; GPX export; Offline; Sharing without account; Wrap-up.

### Open points

- Confirm the assumption that alternatives belong to phase 1.
- Shared routes: immutable, delete token (hashed), a single `shared_routes` table (PostGIS line), strict write limits. QR code: not done yet (needs a library, permission to install pending).
- Left for later (known at the end of milestone 1): the QR code for the share link (needs a library, permission pending); CI never ran on GitHub; real-file import tests (Komoot, Garmin, RideWithGPS); credits of routes saved before the credits existed are missing (their stored `elevationSource` is absent), and shared copies do not carry the source; after an app update the service worker serves the previous version once; a "new version available" bar now offers the reload (checked by hand: old page, bar shown, reload gives the new version); production hosting must answer `index.html` for any path that is not a file (`scripts/serve-static.mjs` does it locally).
- Checked at the end of milestone 1: the exported GPX opens in GDAL's GPX driver (`ogrinfo`) with the right waypoints, one track and every point with its elevation; the production build serves with a working service worker, the `/p/...` fallback, and glyphs and sprites cached from any host (`ngsw-config.json` no longer hardcodes the tiles host); when the network cannot carry a request the service worker answers 504, which the app now maps to its "network/unavailable" messages.

### Backlog (noted 2026-11-08, done 2026-11-09)

- **Bug: three alternatives return nothing** (done, `2cc18d9`). BRouter runs 2 requests at once and kills a running one when a third arrives; the API sent its alternatives together. Calls now wait in the provider (`BROUTER_MAX_CONCURRENT`), and a missing alternative is left out instead of failing the request.
- **Bug: map tiles not always refreshed after moving the map** (done, `fe18c52`). MapLibre does not retry a tile in error while it stays on screen; `retryFailedTiles` does, after a delay and when the map stops moving.
- **Stops by address** (done, `eabf455`). Each stop is a search field; "Add a stop" opens an empty one before the end.
- **My position in the fields** (done, `b22e391`). First choice of an empty Start, End or stop field.
- **Preferred direction for a loop by distance** (done, `2623b3d`). `loop.direction`, 8 compass points or none.
- **Stretch of the elevation profile, grade colours** (done, `f837450`). Distance, ascent, descent and average grade of the selection, highlighted on the map.
- **Live drag** (done, `fb498a4`). The route follows a dragged marker or a waypoint pulled out of the route; Escape cancels, one undo step after the drop.

Checked in a browser against the local stack: the three alternatives on the Clermont-Ferrand to Pavezin trip, the tiles after a failed load, the profile selection and its highlight, the live drag (marker and route line, Escape, drop, Ctrl+Z). Not checked: touch screens (a drag cannot be cancelled there other than by the undo button), Cmd+Z on macOS.

### Asked 2026-11-10 (done 2026-11-10)

Then, the same day: layer switcher and hillshade (brief `relief.md`, plan `relief.md#how-it-went`), done.

Brief: `reverse-fit-snap.md`, plan: `reverse-fit-snap.md#how-it-went`. Reverse the whole route, removal recomputed between the two neighbours, FIT export, points on ways for Road and Gravel, map layer proposals (document only). The proposals are in `docs/map-layers.md`: nothing of them is built; the recommended start is a layer switcher with hillshade from the Copernicus tiles.

Seen on the way, left as they are (backlog of 2026-11-08):

- The basemap extract covers longitude 2.6 to 3.7 and latitude 45.3 to 46.1 only: the map is grey beyond (the end of the Pavezin trip, for instance), while BRouter routes there.
- Three alternatives on that long trip take about 27 s to compute, now that the calls are queued.
- During a drag the web app can send up to 100 `POST /route` a minute, each for a short stretch; the default limit went from 20 to 120 a minute.
