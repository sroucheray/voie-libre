# Plan — user position

Brief: [BRIEF-geolocation.md](BRIEF-geolocation.md). Each step ends with lint, build and targeted tests passing, then one commit. One full run at the end.

1. **Geolocation service and store.** `GEOLOCATION` token (browser `navigator.geolocation` implementation, fake in tests), `LocationStore` (status `idle | searching | active | error`, `fix` with lat, lng, accuracy, heading, error codes, `start()`/`stop()`, secure-context check). Check: store spec.
2. **Driver seam.** `PlannerMapDriver.setLocation(fix | null)`; `maplibre-driver.ts` draws the dot, accuracy circle (GeoJSON circle in metres) and heading cone; first fix centres the map once; fake driver records calls. Check: driver and planner specs.
3. **Button and states.** "Locate me" map control with idle/searching/active states, pressed state, live region, translated errors, insecure-context message. Keys in both languages. Check: component spec, key parity.
4. **Use as start or stop.** "My position" in the map menu and the panel, using `nextRole`, disabled without a fix. Check: planner spec.
5. **Visual check and docs.** Chrome with mocked geolocation; update `CLAUDE.md` (planner section), `docs/architecture.md`; full test run once.

## Open points

- Heading source: `coords.heading` only moves with GPS speed; compass (`deviceorientationabsolute`) may be added later if the cone is too rarely available.
