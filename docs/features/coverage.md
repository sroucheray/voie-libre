# Voie Libre — Brief: a map that covers more than one region

Follow-up to [relief.md](relief.md) and the offline code of milestone 1. Asked on 2026-11-11.

## Problem

The basemap is an extract of the Clermont-Ferrand region (2.6 to 3.7° E, 45.3 to 46.1° N, 42 MB). Outside it the map is grey and the relief is missing. The author's users will ride between Angers and Lyon, and elsewhere in France or in Europe. At the same time, "Download the map" copies the whole archive to the device, which cannot work with a map of France (4.7 GB).

## Who and where

The author and the people who plan rides with it, on desktop and on touch, sometimes with a bad network.

## Decisions already taken

- No tile server: one big PMTiles file on a static host with range requests (nginx here, an object store such as Cloudflare R2 later). The app reads only the bytes it shows. Measured on 2026-11-11 with `pmtiles extract --dry-run` (zooms 0 to 14): Angers-Lyon box 680 MB, France 4.7 GB, Europe 22 GB.
- Offline use becomes "keep this area": the user chooses the area, the app downloads only that.
- Order: offline by area first (on the file we have), then the France file; BRouter segments and the France relief come after (see the end).

## Scope

1. **Offline by area.** The "Download the map" button becomes an offline panel with:
   - **Keep this route offline**: a corridor around the selected route (5 km each side, a constant), shown when a route is on screen;
   - **Keep this view offline**: the rectangle on screen, zooms up to 14;
   - before downloading, the number of tiles and an estimate of the size ("about 150 MB"); a limit (1 GB) above which the app asks for a smaller area; the free space (`navigator.storage.estimate`) is checked;
   - a progress bar and a Cancel button; the glyph and sprite files come with the first area (they are small and shared);
   - the list of kept areas with name, size and date, each removable; removing frees the space;
   - the relief tiles of the same area come along when the relief file exists.
2. **How the map reads it.** Every byte range read from the archive (directories and tiles) is kept in Cache Storage under its exact range; the map reads the cache first and the network after. Downloading an area asks for all its tiles through the PMTiles reader, which fills the cache. Nothing changes for a map that never downloaded anything.
3. **The France file.** `scripts/download-basemap.sh` extracts France by default (`-5.5,41.2,9.8,51.2`, Corsica included) into a file with a generic name (`basemap.pmtiles`, no region in the name); `BASEMAP_BBOX` still lets anyone pick another box. The old `clermont.pmtiles` is left alone.
4. **A notice outside the file.** When the map shows only places the file does not cover (a user with a smaller extract), a short line says so instead of leaving grey with no explanation.

## Done, and how we check it

- Unit tests: the corridor and rectangle to tile lists (counts for known cases), the range cache (hit, miss, exact key), the estimate and the limit, the area list (add, remove, size), quota refusal.
- A spike first, to settle the approach: with a recording source, read every tile of a small box, then read them again with the network refused; it must work from the cache alone.
- By hand in the browser: keep a corridor offline, cut the network (stop the tiles container), pan and zoom inside the area (tiles stay), outside it (grey, with the notice), remove the area (space freed).
- `en.json` and `fr.json` have every new key; `CLAUDE.md` and `docs/architecture.md` updated. Lint, build and targeted tests pass.

## Constraints

- No new runtime dependency. Rules of `CLAUDE.md`. The map still calls no external domain by default.
- Never delete the user's files: the old extract stays; offline copies made with the old format are dropped by the app (cache name changes) and the user is told to download again.

## Out of scope for this brief (next ones)

- Hosting in production (R2 or a VPS); keeping the data up to date.
- BRouter segments beyond `E0_N45` (Angers-Lyon needs `W5_N45`), relief for all of France (about 150 Copernicus files, a 1.4 GB archive), the elevation service for those files.
- Europe.

## How it went

Built in 6 steps, one commit each: Spike (not committed); Tiles of an area; Range cache; Panel; France file; Docs and by-hand check.

### Done (2026-11-11)

Steps 1 to 5: the spike, the tiles of an area, the range cache with the list of areas and the panel (one commit), the France file (`scripts/download-basemap.sh`: `-5.5,41.2,9.8,51.2` into `basemap.pmtiles`; `RELIEF_BBOX` for the relief script), the note outside the file (`basemapBounds`, `BASEMAP_COVERAGE`).

### Checked

In the browser on the small extract: a corridor of 39 km (337 tiles, estimated 11.2 MB, kept 11.7 MB), then with the tiles server stopped the map shows that corridor at zooms 13 and 15 and nothing outside it. Specs for the tiles of an area, the store (plan, keep, cancel, quota, removal, eviction, reload), the panel and the note.

Not checked: touch; the glyphs and sprites offline outside a production build (the service worker does not run in `npm run dev`); the real France file in the browser, at the time of writing the download was running; the corridor of a very long route (Angers to Lyon, about 150 MB estimated, limited to 1 GB).

### Next briefs

- Hosting in production (R2 or a VPS), keeping the data up to date.
- BRouter segments beyond `E0_N45` (Angers to Lyon needs `W5_N45`).
- Relief for all of France (about 150 Copernicus files, a 1.4 GB archive) and the elevation service that reads them.
- Europe.
