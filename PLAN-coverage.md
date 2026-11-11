# Plan — a map that covers more than one region

Brief: [BRIEF-coverage.md](BRIEF-coverage.md). One commit per step, after lint, build and the targeted tests.

1. **Spike (not committed).** Record the ranges read for the tiles of a small box, replay them with the network refused. Settles the range-cache approach and measures the tile size for the estimate.
2. **Tiles of an area.** `core/offline/area-tiles.ts` (pure): tile list of a rectangle and of a corridor around a polyline for zooms 0 to 14, count, estimate. Spec.
3. **Range cache.** Replace the whole-archive store: `OfflineFirstSource` reads `(url, offset, length)` from Cache Storage first; a recording source writes what it reads; `OfflineBasemap` keeps the list of areas (localStorage), downloads one (all tiles through the PMTiles reader, concurrency, progress, cancel, quota), removes one, reports its state. Cache name bumped. Spec.
4. **Panel.** `OfflineMap` becomes the offline panel (route, view, list), keys in `en.json`/`fr.json`; the map-view and planner specs follow.
5. **France file.** `scripts/download-basemap.sh` default box and file name, `BASEMAP_TILES_FILE`, docs; run the script; the notice outside the file.
6. **Docs and by-hand check.** `CLAUDE.md`, `docs/architecture.md`; the browser check of the brief.

## Done (2026-11-11)

Steps 1 to 5: the spike, the tiles of an area, the range cache with the list of areas and the panel (one commit), the France file (`scripts/download-basemap.sh`: `-5.5,41.2,9.8,51.2` into `basemap.pmtiles`; `RELIEF_BBOX` for the relief script), the note outside the file (`basemapBounds`, `BASEMAP_COVERAGE`).

## Checked

In the browser on the small extract: a corridor of 39 km (337 tiles, estimated 11.2 MB, kept 11.7 MB), then with the tiles server stopped the map shows that corridor at zooms 13 and 15 and nothing outside it. Specs for the tiles of an area, the store (plan, keep, cancel, quota, removal, eviction, reload), the panel and the note.

Not checked: touch; the glyphs and sprites offline outside a production build (the service worker does not run in `npm run dev`); the real France file in the browser, at the time of writing the download was running; the corridor of a very long route (Angers to Lyon, about 150 MB estimated, limited to 1 GB).

## Next briefs

- Hosting in production (R2 or a VPS), keeping the data up to date.
- BRouter segments beyond `E0_N45` (Angers to Lyon needs `W5_N45`).
- Relief for all of France (about 150 Copernicus files, a 1.4 GB archive) and the elevation service that reads them.
- Europe.
