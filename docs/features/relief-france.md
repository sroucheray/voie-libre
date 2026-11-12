# Voie Libre — Brief: the relief for all of France

Follow-up to [relief.md](relief.md) and [coverage.md](coverage.md). Asked on 2026-11-11.

## Problem

The basemap now covers France, but the hillshade only exists over the Clermont-Ferrand test region (2.6 to 3.7° E, 45.3 to 46.1° N). Elsewhere the relief tiles are flat (no data reads as sea level) or missing, so the shading shows as a rectangle around Clermont-Ferrand.

## Decision already taken

Make the relief ourselves from Copernicus GLO-30 (open, free, offline, nobody to depend on), like the basemap: one static PMTiles file on the same static host. The user agreed to this over an external terrain source.

## Scope

1. **Download the elevation tiles of France.** `scripts/download-relief.sh france` takes every 1° square of `-5..10° E` by `41..51° N` that exists (measured on 2026-11-11: 133 of 150, 4.61 GB; the 17 missing are sea) from the public Copernicus bucket, four at a time, skipping the ones already there. The existing call with explicit tile names keeps working. Files stay in `data/relief` (not committed).
2. **Build the relief for all of them.** `npm run build-relief` no longer reads every GeoTIFF into memory (133 files of 52 MB would not fit): it keeps a few cells in memory, loads a file when a tile needs it, and drops the oldest. The area to build is the one the files cover unless `RELIEF_BBOX` says otherwise. Same tiles as before (terrarium PNG, 512 px, zooms 6 to 11, 0.25 m steps), with a progress line, and the MBTiles written in batches. Estimated: about 9,000 tiles, about 1.8 GB, about an hour.
3. **Serve and use.** The file is the same `relief.pmtiles` next to `basemap.pmtiles`; nothing changes in the app (the map, the layer switcher, the offline areas that already take the relief tiles of an area). The elevation service of the API (climb of an imported route) reads the same files, so it covers France too.
4. **Keep the app honest outside the file.** Outside the relief file the hillshade is absent without a message (the map is the basemap alone); nothing to build for that.

## Done, and how we check it

- Unit tests for the new cell store (loads on demand, keeps at most N, a missing file reads as sea level, a point on a cell border reads from the right cell) and for the pure helpers; the existing `relief-tiles` specs keep passing.
- By hand: the script on a small box first (the 2 existing files give the same tiles as before, byte for byte except for ordering), then the whole of France; in the browser the hillshade at Lyon, Angers, the Alps, the Pyrenees and Corsica at zooms 7, 9 and 11; the offline area of a route there takes the relief tiles.
- `CLAUDE.md`, `README.md` and `docs/architecture.md` updated. Lint and build pass.

## Constraints

- No new dependency. The elevation data is credited where it is shown (already the case: "Relief: Copernicus").
- Never delete the user's files: the old `relief.pmtiles` is replaced only when the new one is complete (the script already writes `.part` first).

## Out of scope

- Europe or the world; zooms deeper than 11; contour lines or slope shading; hosting in production; the BRouter segments.

## How it went

Built in 4 steps, one commit each: Download script; Cell store and build script; Build France; Docs.

### Done and checked (2026-11-11)

133 Copernicus files downloaded (4.6 GB), `npm run build-relief` ran for about two hours (not one: the lowest zooms read dozens of files per tile and were slow) and wrote `data/basemap/relief.pmtiles`: 9,646 tiles, 1.65 GB, over 5° W to 10° E and 41 to 51° N. Memory stayed near 2 GB.

In the browser, the hillshade at zoom 9 in the Alps (Mont Blanc, Geneva, Annecy) and in Corsica, at zoom 6 over all of France (Alps, Pyrenees, Massif Central, Vosges), at zoom 11 around Lyon. `POST /elevation` reads the same files: Lyon 160 m, Angers 51 m, Clermont-Ferrand 415 m, the Pyrenees 2,316 m, Corsica 1,498 m, open sea 0.

Not checked: the Pyrenees on screen (the capture failed when the page reloaded; the elevation service answers there), the offline area of a route far from Clermont-Ferrand, touch.

Left as it is:

- The build took about two hours: the lowest zooms (6 to 9) are slow because one tile reads many files. Worth parallelising (worker threads) if it has to be rebuilt often.
- North of 50° N the Copernicus squares have fewer columns; not checked at the northern edge.
- The relief and the basemap are served by the same static host: the 1.65 GB file goes to the production host with the 4.7 GB basemap.
