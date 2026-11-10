# Plan — layer switcher and hillshade

Brief: [BRIEF-relief.md](BRIEF-relief.md). One commit per step, after lint, build and the targeted tests of the step. The full suite runs once, at step 5.

1. **Relief tiles.** `scripts/relief-tiles.mjs` (pure: tile ranges of a bounding box, pixel to longitude and latitude, terrarium bytes, PNG encoding) with its spec in `apps/api` (Jest, like the other Node code), and `scripts/build-relief-tiles.mjs` (reads the GeoTIFFs, writes an MBTiles file with `node:sqlite`, converts it with `pmtiles convert`). Check: the spec; the script on the test region, size printed.
2. **Hillshade in the style.** `buildBasemapStyle(baseUrl, language, { relief })`: `raster-dem` source on `relief.pmtiles`, `hillshade` layer before `water`; `reliefTilesUrl`. `MapView` probes the file once (offline copy, else a `HEAD` request) and builds the style accordingly. Check: `basemap-style.spec.ts`, `map-view.spec.ts`.
3. **Layer switcher.** `MapLayers` (preference in `localStorage`, default on) and the control in `MapView` (button, panel, checkbox, disabled note, Escape and outside click); visibility through `setLayoutProperty`; Copernicus in the attribution. Keys in `en.json`/`fr.json`. Check: `map-view.spec.ts`, a spec for the preference.
4. **Offline.** `OfflineBasemap` keeps several archives (`readerFor(url)`), downloads the relief after the basemap (a 404 is skipped), removes both; `MapCreateOptions.offlineTiles` becomes a list. Check: `offline-basemap.spec.ts`, `offline-map.spec.ts`.
5. **Wrap-up.** Browser check of the brief's cases; `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/map-layers.md` (1 and 2 done), `PLAN.md`. Full run once.
