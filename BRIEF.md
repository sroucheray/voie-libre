# Voie Libre — Brief

Source of truth for architecture: [docs/architecture.md](docs/architecture.md). This brief only fixes what the first milestone is.

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

`docs/architecture.md` with its two diagrams under `docs/diagrams/`, this brief, `PLAN.md`, and a finished spike (`spike/brouter/`) that validated BRouter locally: avoid zones (circle, line, polygon), alternatives, GPX with elevation, and memory needs. No application code yet.
