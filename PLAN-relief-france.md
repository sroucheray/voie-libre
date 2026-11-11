# Plan — the relief for all of France

Brief: [BRIEF-relief-france.md](BRIEF-relief-france.md). One commit per step, after lint, build and the targeted tests.

1. **Download script.** `france` region, parallel downloads, 404 means sea (skipped), existing arguments kept; start the download (4.6 GB) in the background.
2. **Cell store and build script.** A `CellStore` (index of the files by their corner, loads on demand, small LRU), `renderTile` reading through it, batches of inserts, progress; the area from the files unless `RELIEF_BBOX`. Spec for the store (the pure part lives in `libs/shared` or `scripts` with a spec). Run on the 2 old files and compare the tile count with the old archive.
3. **Build France** (background, about an hour), serve, check in the browser.
4. **Docs.** `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/map-layers.md`.
