# Plan — ways suited to the profile (done 2026-11-11)

Brief: [BRIEF-ways.md](BRIEF-ways.md). One commit, after lint, build and the targeted tests.

1. **Levels and layers.** `core/map/way-levels.ts` (pure table, `wayLevel`, `wayLayers(profile)`: three `line` layers on the `roads` source layer, avoid under possible under suited), `buildBasemapStyle(..., { ways })` inserts them before the first label layer.
2. **Switcher.** `MapLayers.ways` (off by default), `MapView` input `waysProfile`, checkbox and legend, restyle keyed on language, relief and ways; `planner.html` passes the selected profile.
3. **Keys, tests, docs.** `map.layers.ways*` in `en.json`/`fr.json`; specs; `CLAUDE.md`, `docs/map-layers.md`.

## Checked

In the browser on the local stack, with the layer on: Road (small roads green, main roads orange, motorways red dashed), Gravel, Trail (paths green in the woods, roads orange); the legend in the switcher; the map restyled when the profile changes. Specs for the table, the style, `MapLayers` and `MapView`; lint and build.

Not checked: touch; the cost of `setStyle` on a slow device at each profile change; zooms below 12 (only main roads are in the tiles there).
