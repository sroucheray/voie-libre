# Plan — surface and way type of the route (done 2026-11-11)

Brief: [BRIEF-surface.md](BRIEF-surface.md). One commit per step, after lint, build and the targeted tests of the step.

1. **API: classify and carry.** `routing/surface.ts` (table, `classifyWay(tags)`), `parseGeoJson` reads the messages and fills `RouteResult.surfaces` (messages are matched to geometry points by their end coordinates; a mismatch leaves `surfaces` out); `trimSpurs`, `loops.ts` and round trips keep it in step; `POST /route` schema; `npm run generate-client`. Check: `surface.spec.ts`, `brouter-provider.spec.ts` (fixture), `spurs.spec.ts`, `loops.spec.ts`, the integration spec.
2. **Web: state and storage.** `PlannedRoute.surfaces`, route-planner mapping, `applyStretch` splice, saved routes. Check: `planner-store.spec.ts`, `route-planner.spec.ts`, `local-edit.spec.ts`, `indexeddb-route-store.spec.ts`.
3. **Web: the bar and the legend** under the elevation chart. Check: `elevation-panel.spec.ts`.
4. **Web: the route on the map** and the checkbox. Check: `map-view.spec.ts`, `planner.spec.ts`, `map-layers.spec.ts`.
5. **Docs and by-hand check.**

## Checked

Against the live stack: `POST /route` for a gravel route returns 490 codes for 491 points (paved, cycleway, unpaved and path present); the recorded real BRouter spec and the opt-in integration spec (a route and an "avoid the way out" loop); in the browser, the bar and its legend under the chart, the route coloured on the map from the switcher, and an added stop (local edit) leaving 822 codes for 823 points.

Not checked: touch; saving and reopening a route by hand (the spec does it); a round trip by distance (the integration spec covers loops by the way out only).

Left as it is:

- Cobbles count as unpaved or rough though they are paved: a rough ride, which is what the category tells.
- Imported files, shared links and routes saved before this change have no surface bar: they say so and offer "Calculate the surface", which computes the route again between its points (the result can differ from the stored track, an imported one included; Undo brings it back). Found when the author turned the layer on over a route saved earlier.
- The surface is not carried to the GPX or FIT export.
