# Plan — reverse, wider removal, FIT export, points on ways, layer proposals

Brief: [BRIEF-reverse-fit-snap.md](BRIEF-reverse-fit-snap.md). One commit per step, after lint, build and the targeted tests of the step. The full suite runs once, at step 7.

1. **Reverse the route.** `PlannerStore.swapEnds` → `reverse` (all points reversed; loops with stops keep their start; disabled for a loop without stops); button label and keys in `en.json`/`fr.json`; `planner.html`. Check: `planner-store.spec.ts`, `planner.spec.ts`.
2. **Removal between the two neighbours.** `planLocalEdit` (`local-edit.ts`), `remove` branch: window = vertices of the neighbouring points, points = the two neighbours; same place → `null` (full compute); the spur code goes. Check: `local-edit.spec.ts`, `route-planner.spec.ts`; by hand, a stop on a long detour.
3. **FIT encoder.** `apps/web/src/app/export/fit.ts`: `buildFit(source)` → `Uint8Array` (header, definitions, `file_id`, `course`, `lap`, events, `record`s, `course_point`s, CRC-16), `fitFileName`. Install `fit-file-parser` as a dev dependency (after the author's go) and read the file back in `fit.spec.ts`. Check: the spec.
4. **FIT in the saved routes list.** The "Export" button offers GPX and FIT (small menu, keyboard and touch); `FILE_DOWNLOADER` takes binary content if it does not yet; error code `export_failed` covers both. Check: `saved-routes.spec.ts`, `file-download.spec.ts`; by hand, the file in a FIT viewer.
5. **Snapping rule.** `apps/web/src/app/planner/snap-to-way.ts` (pure): from candidate way geometries (lines with their `kind`), the profile and the place, the nearest point on a usable way within the two thresholds, or `null`. Check: `snap-to-way.spec.ts`.
6. **Snapping on the map.** `PlannerMapDriver.snap(place, profile)` (real driver: `queryRenderedFeatures` on the basemap's road layers around the place; fake in tests); `Planner` applies it to clicks, the map menu, drops, insert drags and the ghost marker; refusal message (toast, translated); no snapping on Trail, nor where no tile is loaded. Check: `planner.spec.ts`; by hand, the cases of the brief.
7. **Layer proposals and wrap-up.** Write `docs/map-layers.md` (sizes measured on the test region where possible: hillshade tiles from the two Copernicus files). Update `CLAUDE.md`, `docs/architecture.md`, `PLAN.md`. Full run once: `npm run lint`, `npm run build`, `npm test`.

## Open points

- Snapping thresholds (24 px, 100 m) are a first guess.
- The Protomaps tiles carry road classes, not surfaces: on Gravel a paved minor road and a track both count as usable, which is what the profile routes on anyway.
