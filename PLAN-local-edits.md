# Plan — local edits of a route

Brief: [BRIEF-local-edits.md](BRIEF-local-edits.md). Each step ends with lint, build and targeted tests passing, then one commit. One full run at the end.

1. **Pure module `local-edit.ts`** (`apps/web/src/app/planner`). Projection of a point on the geometry (nearest vertex, with its distance), `editWindow` (vertex range from the 500 m floor and the 2 × distance rule, clamped to the neighbouring visible points and the ends), `splice` (head + new stretch + tail) and `totals` (distance from the geometry, climb from the elevation deltas, duration in proportion to distance). Reuses `insertionIndex` for the segment. Check: `local-edit.spec.ts`.
2. **Store.** `PlannerStore` records the last edit (`add | insert | move | remove`, index, previous point) next to the points, and `applyLocalEdit(stretch)` replaces the selected route with the spliced one, keeping only that alternative and marking its inputs as restored so `RoutePlanner` does not recompute. Check: `planner-store.spec.ts`.
3. **RoutePlanner.** When the change is a recorded edit and the store has a selected geometry, send only the window (three points, one alternative, abort stale, debounce), splice the answer in, else fall back to the full recompute. Profile or alternatives changes always recompute everything. A failed request keeps the route and sets the error. Check: `route-planner.spec.ts` (one `POST /route`, three points, geometry outside the window unchanged).
4. **All routes.** Loop modes (`distance`, `avoid_outbound`, back to the start), A to B, saved and shared routes opened through `loadSaved`, imported GPX. The loop mode is dropped on the first edit but the geometry stays. Check: `planner.spec.ts` for each kind, loading still makes no call.
5. **Visual check and docs.** Chromium on a 30 km loop by distance: a point on the loop, a point beside it, move and remove, the rest does not move. Update `CLAUDE.md` (planner section) and `docs/architecture.md`; full test run once.

## Open points

- Window factor and floor to tune after step 5.
- A point added very near the start or end of a route: the window is clamped, so it may replace most of a short route; check in step 5.
