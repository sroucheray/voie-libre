# Voie Libre — Brief: layer switcher and hillshade

Follow-up to [docs/map-layers.md](docs/map-layers.md) (proposals 1 and 2), asked on 2026-11-10.

## Problem

The map is flat: nothing shows where the climbs are before a route is computed. The elevation data is already on disk for the API (Copernicus GLO-30), but the map does not use it.

## Who and where

The author, on desktop and on touch. Nothing may depend on hover.

## Scope

1. **Relief tiles, built locally.** A script (`scripts/build-relief-tiles.ts`, run by `npm run build-relief`) turns the Copernicus GeoTIFFs of `data/relief` into elevation tiles for the map: Web Mercator, 512 px, zooms 6 to 11 (zoom 11 is about the 30 m of the data; the map stretches it beyond), elevations rounded to 0.25 m in the "terrarium" encoding MapLibre reads, PNG, over the same area as the basemap (`BASEMAP_BBOX`). The result is `data/basemap/relief.pmtiles`, served by the existing `tiles` service. Places without elevation data are at sea level.
2. **Hillshade on the map.** A `raster-dem` source and one `hillshade` layer, drawn above the land cover and under the water, the roads and the labels. Soft enough that roads, the route and names stay readable.
3. **Shown by default.** The relief is on when the map opens.
4. **Layer switcher.** A button under the zoom buttons opens a small panel listing the overlays, with one entry for now: Relief (a checkbox). Angular, translated, usable by keyboard and touch; Escape or a click outside closes it. The choice is kept on the device (`localStorage`) and never sent.
5. **Without the relief file** (script not run, or offline without a downloaded copy), the map works as before: no error, and the Relief entry is disabled with a short note.
6. **Offline, with the map.** "Download the map" also downloads the relief archive; "Remove" deletes both; the size shown is the total. A relief file missing on the server does not fail the download of the map.
7. **Credit.** While the relief is shown, the map's attribution names Copernicus.

## Done, and how we check it

- Unit tests: the tile math and the terrarium encoding of the script (pure functions); the style with and without relief (layer order, source); the switcher (default on, toggling, the stored choice, disabled without the file, keyboard); the offline service with two archives (download, read by URL, remove, relief missing).
- The script runs on the two Copernicus files of the test region and prints the size of the archive.
- By hand, in a browser against the local stack: relief visible around Clermont-Ferrand (the Puy de Dôme range to the west), toggled off and on, the choice kept after a reload, the map unchanged when the file is renamed away.
- `en.json` and `fr.json` have every new key. Lint, build and the full test run pass once at the end.
- `CLAUDE.md`, `README.md` (the one-time data commands) and `docs/architecture.md` are up to date.

## Constraints

- Stack and rules of `CLAUDE.md`. The map calls no external domain: the relief is served locally like the basemap.
- No new dependency: the script uses `geotiff` (already there), Node's own `node:sqlite` and `zlib`, and the `pmtiles` command line or its Docker image, like `download-basemap.sh`.
- One commit per step.

## Out of scope

- Contours, slope shading, 3D terrain, imagery, ways for the profile (other proposals of `docs/map-layers.md`).
- A base layer choice in the switcher (there is one base).
- Relief beyond the basemap's area; a relief download separate from the map's.
