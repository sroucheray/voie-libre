# Voie Libre — Brief: the relief from public terrain tiles

Follow-up to [relief.md](relief.md) and [relief-france.md](relief-france.md). Decided on 2026-11-11.

## Problem

Making the relief ourselves worked, but it is heavy: 4.6 GB of Copernicus files to download, about two hours of computation, 1.65 GB to host, and an extension to Europe would start over. The same hillshade can be drawn from public terrain tiles that already cover the world.

## Decision

By default the map draws the hillshade from the public AWS Terrain Tiles ("Terrarium" encoding, 256 px PNG, zooms 0 to 15, no key, CORS open, data last modified in 2017): `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. The local file made from Copernicus stays as an option for a deployment that wants its own data or no external call (`RELIEF_SOURCE` token: `'public'` by default, `'local'`).

## Scope

1. **Public source by default.** The hillshade source reads `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/...` through a small `vlterrain://` protocol of MapLibre, so that the tiles kept offline are read before the network. The map reads zooms 0 to 12 (the server has up to 15, but the elevations are about 30 m apart, which zoom 12 already shows; deeper zooms are drawn from those tiles, and an area kept offline covers them all).
2. **The user is told.** This is the second external host after the IGN photos, now on by default: a note under the "Relief" checkbox says it loads tiles from a public Amazon server, which sees the user's address and the area looked at; the checkbox turns it off. The credit says what the data is ("Relief: Terrain Tiles, Mapzen, AWS; NASA, ESA and others", with a link to the list of sources).
3. **Offline areas keep the relief tiles.** A kept area (corridor of the route, or the view) stores the terrain tiles of its zone at zooms 6 to 12 in its own cache, next to the basemap ranges; the size estimate counts them; removing the area removes them. Above zoom 12 the map zooms the tiles kept.
4. **The local file stays possible.** `RELIEF_SOURCE = 'local'` gives today's behaviour unchanged (probe of `relief.pmtiles`, ranges kept in the areas). The scripts, the Copernicus files and `relief.pmtiles` are not deleted.
5. **Not changed here:** the API's elevation service (the climb of an imported route) still reads the Copernicus files.

## Done, and how we check it

- Unit tests: the style (public source by default, `vlterrain` tiles, 256 px, zoom 15; local unchanged), the protocol (kept tile first, network otherwise, an error is an error), `MapView` (note, credit, available at once), the offline areas (public tiles planned, estimated, kept, removed), the local option still passing its old tests.
- By hand in the browser: the hillshade in the Alps, Corsica and around Lyon with the public source, the request going to `s3.amazonaws.com`, the checkbox off meaning no call, an area kept offline and the network cut.
- `en.json` and `fr.json` have every new key; `CLAUDE.md`, `README.md` and `docs/architecture.md` updated. Lint, build and targeted tests pass.

## Constraints

- No new dependency. Never delete the user's files. The data is credited where it is shown.

## Out of scope

- Moving the elevation service of the API to the terrain tiles; Europe-specific sources; hosting terrain tiles ourselves.

## How it went

Built in 4 steps, one commit each: Source, protocol and style; The switcher; Offline areas; Docs and by-hand check.

### Done and checked (2026-11-11)

In the browser: with the public source the hillshade draws the Alps (Mont Blanc) from 32 tiles of `s3.amazonaws.com`, all answered 200; the credit "Relief: Terrain Tiles (Mapzen, NASA, ESA…)" links to the list of sources; a corridor of 39 km kept offline was estimated at 12.3 MB and weighed 12.2 MB (357 tiles, 35 of them terrain tiles); with Amazon blocked, no tile of the kept area was asked of the network, at zooms 9, 11, 13 and 15 (the tiles outside the area failed, as expected).

Found by that check: the source first went to zoom 15 while areas keep zooms 6 to 12, so the hillshade would have vanished offline at high zoom. The map now stops at zoom 12: the elevations are about 30 m apart, which zoom 12 already shows.

Not checked: touch; the hillshade in Europe outside France (the source is global, not looked at); the local source in the browser (its tests pass, unchanged).

Left as it is:

- The API's elevation service (climb of an imported route) still reads the Copernicus files: 4.6 GB on the API host. To drop them, read the terrain tiles instead (less precise).
- `relief.pmtiles` (1.65 GB) and the Copernicus files stay on disk, unused by default.
- The terrain tiles are a public server without any promise; the local source is the way out if it ever goes away.
