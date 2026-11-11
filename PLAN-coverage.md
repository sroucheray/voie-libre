# Plan — a map that covers more than one region

Brief: [BRIEF-coverage.md](BRIEF-coverage.md). One commit per step, after lint, build and the targeted tests.

1. **Spike (not committed).** Record the ranges read for the tiles of a small box, replay them with the network refused. Settles the range-cache approach and measures the tile size for the estimate.
2. **Tiles of an area.** `core/offline/area-tiles.ts` (pure): tile list of a rectangle and of a corridor around a polyline for zooms 0 to 14, count, estimate. Spec.
3. **Range cache.** Replace the whole-archive store: `OfflineFirstSource` reads `(url, offset, length)` from Cache Storage first; a recording source writes what it reads; `OfflineBasemap` keeps the list of areas (localStorage), downloads one (all tiles through the PMTiles reader, concurrency, progress, cancel, quota), removes one, reports its state. Cache name bumped. Spec.
4. **Panel.** `OfflineMap` becomes the offline panel (route, view, list), keys in `en.json`/`fr.json`; the map-view and planner specs follow.
5. **France file.** `scripts/download-basemap.sh` default box and file name, `BASEMAP_TILES_FILE`, docs; run the script; the notice outside the file.
6. **Docs and by-hand check.** `CLAUDE.md`, `docs/architecture.md`; the browser check of the brief.

## Done so far (2026-11-11)

Steps 1 to 4 (the spike, the tiles of an area, the range cache with the list of areas, the panel), in one commit for steps 3 and 4. Checked in the browser on the small extract: a corridor of 39 km (337 tiles, estimated 11.2 MB, kept 11.7 MB), then with the tiles server stopped the map shows that corridor at zooms 13 and 15 and nothing outside it. Left: step 5 (the France file, the notice outside the file), then the docs.
