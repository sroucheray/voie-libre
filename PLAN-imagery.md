# Plan — aerial photos from the IGN (done 2026-11-11)

Brief: [BRIEF-imagery.md](BRIEF-imagery.md). One commit, after lint, build and the targeted tests.

1. **Style.** `buildBasemapStyle(..., { imagery })`: raster source and layer after the background, the basemap's fill layers dropped, the relief after the photos; `IMAGERY_HOST`, `IMAGERY_TILES`.
2. **Switcher.** `MapLayers.imagery` (off by default), checkbox with the note, `NetworkStatus` to disable it offline and fall back, credit in the attribution; restyle keyed on language, relief, ways and imagery.
3. **Keys, tests, docs.** `map.layers.imagery*`, `map.attribution.imagery`; specs; `CLAUDE.md`, `docs/map-layers.md`.

## Checked

In the browser on the local stack: at zoom 15 around Clermont-Ferrand the photos replace the land with the roads, the ways of the profile and the names over them, "Photos: IGN" in the credit; the only external host the page contacted was `data.geopf.fr`, and none at all with the box unticked (by default). Specs for the style, `MapLayers` and `MapView` (including offline).

Not checked: touch; the network really cut with the photos on (the spec fakes it); outside France (the photos are empty there); the Géoplateforme's usage limits for heavier use.
