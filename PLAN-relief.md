# Plan — layer switcher and hillshade (done 2026-11-10)

Brief: [BRIEF-relief.md](BRIEF-relief.md). One commit per step, after lint, build and the targeted tests of the step. The full suite runs once, at step 5.

1. **Relief tiles.** `libs/shared/src/lib/relief-tiles.ts` (pure: tile ranges of a bounding box, pixel to longitude and latitude, terrarium bytes; shared with the map style) with its spec, and `scripts/build-relief-tiles.ts` (`npm run build-relief`: reads the GeoTIFFs, encodes PNG tiles, writes an MBTiles file with `node:sqlite`, converts it with `pmtiles convert`). Check: the spec; the script on the test region, size printed.
2. **Hillshade in the style.** `buildBasemapStyle(baseUrl, language, { relief })`: `raster-dem` source on `relief.pmtiles`, `hillshade` layer before `water`; `reliefTilesUrl`. `MapView` probes the file once (offline copy, else a `HEAD` request) and builds the style accordingly. Check: `basemap-style.spec.ts`, `map-view.spec.ts`.
3. **Layer switcher.** `MapLayers` (preference in `localStorage`, default on) and the control in `MapView` (button, panel, checkbox, disabled note, Escape and outside click); visibility through `setLayoutProperty`; Copernicus in the attribution. Keys in `en.json`/`fr.json`. Check: `map-view.spec.ts`, a spec for the preference.
4. **Offline.** `OfflineBasemap` keeps several archives (`readerFor(url)`), downloads the relief after the basemap (a 404 is skipped), removes both; `MapCreateOptions.offlineTiles` becomes a list. Check: `offline-basemap.spec.ts`, `offline-map.spec.ts`.
5. **Wrap-up.** Browser check of the brief's cases; `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/map-layers.md` (1 and 2 done), `PLAN.md`. Full run once.

## Checked

- The script on the two Copernicus files of the test region: 100 tiles, 19.6 MB, 52 s.
- In a browser against the local stack: the relief around Clermont-Ferrand at zoom 11 and 13.5 (the Chaîne des Puys stands out, names and roads stay readable, no steps on flat ground); the switcher turns it off and on and stores the choice; the credit follows; "Download the map" gives 62.3 MB with the relief archive readable from the device, and removing deletes both.

Not checked by hand: the map with the relief file missing (tests only); the relief with the network really off (the tiles server was left running); the switcher on a touch screen.

Left as it is:

- The steps 2 and 3 went in one commit: the style and the switcher were written together.
- The archive is rebuilt in full each time; it must be rebuilt when `BASEMAP_BBOX` changes.
