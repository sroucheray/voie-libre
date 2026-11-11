# Plan — the relief for all of France (done 2026-11-11)

Brief: [BRIEF-relief-france.md](BRIEF-relief-france.md). One commit per step, after lint, build and the targeted tests.

1. **Download script.** `france` region, parallel downloads, 404 means sea (skipped), existing arguments kept; start the download (4.6 GB) in the background.
2. **Cell store and build script.** A `CellStore` (index of the files by their corner, loads on demand, small LRU), `renderTile` reading through it, batches of inserts, progress; the area from the files unless `RELIEF_BBOX`. Spec for the store (the pure part lives in `libs/shared` or `scripts` with a spec). Run on the 2 old files and compare the tile count with the old archive.
3. **Build France** (background, about an hour), serve, check in the browser.
4. **Docs.** `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/map-layers.md`.

## Done and checked (2026-11-11)

133 Copernicus files downloaded (4.6 GB), `npm run build-relief` ran for about two hours (not one: the lowest zooms read dozens of files per tile and were slow) and wrote `data/basemap/relief.pmtiles`: 9,646 tiles, 1.65 GB, over 5° W to 10° E and 41 to 51° N. Memory stayed near 2 GB.

In the browser, the hillshade at zoom 9 in the Alps (Mont Blanc, Geneva, Annecy) and in Corsica, at zoom 6 over all of France (Alps, Pyrenees, Massif Central, Vosges), at zoom 11 around Lyon. `POST /elevation` reads the same files: Lyon 160 m, Angers 51 m, Clermont-Ferrand 415 m, the Pyrenees 2,316 m, Corsica 1,498 m, open sea 0.

Not checked: the Pyrenees on screen (the capture failed when the page reloaded; the elevation service answers there), the offline area of a route far from Clermont-Ferrand, touch.

Left as it is:

- The build took about two hours: the lowest zooms (6 to 9) are slow because one tile reads many files. Worth parallelising (worker threads) if it has to be rebuilt often.
- North of 50° N the Copernicus squares have fewer columns; not checked at the northern edge.
- The relief and the basemap are served by the same static host: the 1.65 GB file goes to the production host with the 4.7 GB basemap.
