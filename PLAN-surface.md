# Plan — surface and way type of the route

Brief: [BRIEF-surface.md](BRIEF-surface.md). One commit per step, after lint, build and the targeted tests of the step.

1. **API: classify and carry.** `routing/surface.ts` (table, `classifyWay(tags)`), `parseGeoJson` reads the messages and fills `RouteResult.surfaces` (messages are matched to geometry points by their end coordinates; a mismatch leaves `surfaces` out); `trimSpurs`, `loops.ts` and round trips keep it in step; `POST /route` schema; `npm run generate-client`. Check: `surface.spec.ts`, `brouter-provider.spec.ts` (fixture), `spurs.spec.ts`, `loops.spec.ts`, the integration spec.
2. **Web: state and storage.** `PlannedRoute.surfaces`, route-planner mapping, `applyStretch` splice, saved routes. Check: `planner-store.spec.ts`, `route-planner.spec.ts`, `local-edit.spec.ts`, `indexeddb-route-store.spec.ts`.
3. **Web: the bar and the legend** under the elevation chart. Check: `elevation-panel.spec.ts`.
4. **Web: the route on the map** and the checkbox. Check: `map-view.spec.ts`, `planner.spec.ts`, `map-layers.spec.ts`.
5. **Docs and by-hand check.**
