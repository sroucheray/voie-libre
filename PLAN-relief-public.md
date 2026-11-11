# Plan — the relief from public terrain tiles (done 2026-11-11)

Brief: [BRIEF-relief-public.md](BRIEF-relief-public.md). One commit per step, after lint, build and the targeted tests.

1. **Source, protocol and style.** `core/map/relief-source.ts` (constants, `RELIEF_SOURCE` token, tile URL), `buildBasemapStyle(..., { reliefSource })`, the `vlterrain` protocol in `map-factory.ts` (kept tile first). Specs.
2. **The switcher.** `MapView`: relief available at once for the public source, note under the checkbox, credit; `local` keeps the probe. Keys in `en.json`/`fr.json`. Specs.
3. **Offline areas.** Plan, estimate, keep and remove the public tiles of an area. Specs.
4. **Docs and by-hand check.**

## Done and checked (2026-11-11)

In the browser: with the public source the hillshade draws the Alps (Mont Blanc) from 32 tiles of `s3.amazonaws.com`, all answered 200; the credit "Relief: Terrain Tiles (Mapzen, NASA, ESA…)" links to the list of sources; a corridor of 39 km kept offline was estimated at 12.3 MB and weighed 12.2 MB (357 tiles, 35 of them terrain tiles); with Amazon blocked, no tile of the kept area was asked of the network, at zooms 9, 11, 13 and 15 (the tiles outside the area failed, as expected).

Found by that check: the source first went to zoom 15 while areas keep zooms 6 to 12, so the hillshade would have vanished offline at high zoom. The map now stops at zoom 12: the elevations are about 30 m apart, which zoom 12 already shows.

Not checked: touch; the hillshade in Europe outside France (the source is global, not looked at); the local source in the browser (its tests pass, unchanged).

Left as it is:

- The API's elevation service (climb of an imported route) still reads the Copernicus files: 4.6 GB on the API host. To drop them, read the terrain tiles instead (less precise).
- `relief.pmtiles` (1.65 GB) and the Copernicus files stay on disk, unused by default.
- The terrain tiles are a public server without any promise; the local source is the way out if it ever goes away.
