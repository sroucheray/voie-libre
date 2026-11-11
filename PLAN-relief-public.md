# Plan — the relief from public terrain tiles

Brief: [BRIEF-relief-public.md](BRIEF-relief-public.md). One commit per step, after lint, build and the targeted tests.

1. **Source, protocol and style.** `core/map/relief-source.ts` (constants, `RELIEF_SOURCE` token, tile URL), `buildBasemapStyle(..., { reliefSource })`, the `vlterrain` protocol in `map-factory.ts` (kept tile first). Specs.
2. **The switcher.** `MapView`: relief available at once for the public source, note under the checkbox, credit; `local` keeps the probe. Keys in `en.json`/`fr.json`. Specs.
3. **Offline areas.** Plan, estimate, keep and remove the public tiles of an area. Specs.
4. **Docs and by-hand check.**
