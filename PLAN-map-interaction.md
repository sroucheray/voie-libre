# Plan — map interaction

Brief: [BRIEF-map-interaction.md](BRIEF-map-interaction.md). Each step ends with lint, build and targeted tests passing, then one commit. One full run at the end.

1. **Store rules.** `PlannerStore.insertPoint(index, point)`, `closeLoop()`, `isLoop` computed (end equals start), `nextRole` computed (what the next click gives). `addPoint` unchanged in behaviour. Check: store spec (roles, insertion order, loop, `MAX_POINTS`, `loadSaved` still skips `POST /route`).
2. **Distinct markers.** Marker shapes and colours per role, combined start/end marker for a loop; driver `MarkerSpec` gets the loop flag. Check: driver and planner specs; visual.
3. **Ghost marker (desktop).** `PlannerMapDriver.setGhost(role | null)` follows `mousemove`, hidden over markers, over a route being hit, on touch (`pointer: coarse`) and when the map loses the pointer. Check: spec with the fake driver; visual.
4. **Help bar.** Component text per state with the gestures, live region, new Transloco keys in both languages. Check: component spec; key parity test; visual.
5. **Loop.** "Loop" button from two points on, magnet on the start marker, dialog with three choices (only *back to start* enabled, two disabled with "soon"). Check: specs for the dialog and the button; visual.
6. **Insert on route.** Drag the selected route to create a waypoint at the dragged segment's position (driver reports the segment index from the geometry, store inserts). Check: spec for index computation; visual.
7. **Touch menu.** Long press on the map: set start / add stop / set end; long press on a marker removes it with an undo toast. Check: spec; emulated touch in the browser.
8. **Wrap-up.** Full test run once, update `docs/architecture.md` and `CLAUDE.md` (planner section), note the two disabled loop options in open points.

## Open points

- Segment index for drag-to-insert: map the dragged position to the nearest route vertex, then to the waypoint segment (waypoints are not stored as route vertices, so match by cumulative distance).
- Undo for marker removal: a simple toast with "Undo" for a few seconds, no history stack.

## Status

All steps done. Known limits:

- A route that goes out and back along the same road is ambiguous for drag-to-insert: the press matches the nearest vertex, which may belong to the return leg, so the waypoint can land one segment later than expected.
- A press that starts on the selected route claims the gesture from the map, so panning by grabbing the route itself drags the route instead (touch tolerance is 14 px).
- "Avoid the same way back" and "loop by distance" are disabled in the dialog; they need server work.
