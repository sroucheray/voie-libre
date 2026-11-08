# Plan — undo and redo

Brief: [BRIEF-undo.md](BRIEF-undo.md). Each step ends with lint, build and targeted tests passing, then one commit. One full run at the end.

1. **History in `PlannerStore`.** A `Snapshot` (points, profile, alternatives, loop state, routes, selected) with `routes: null` when the route on screen is not up to date with the points (status not `ready`). Private `record()` called before every mutation of the inputs (`setPoints`, `clear`, `setProfile`, `setAlternatives`, `closeLoop`, `setLoopDistance`, `setLoopAscent`), `undo()`, `redo()`, `canUndo` and `canRedo` signals, depth 20, redo emptied on a new change, history emptied by `loadSaved`. Restoring sets the states, marks the inputs as restored when a route comes back (`inputsSignature`) so `RoutePlanner` skips it, and `removed` is cleared. Check: `planner-store.spec.ts`.
2. **RoutePlanner interplay.** Nothing new in the effect, but tests that pin it: no `POST /route` after undo or redo of a computed route, a snapshot without route computes, an in-flight request is aborted by an undo, an edit after an undo is a local edit (`editBehind` and `seenPoints` stay right). Fix what the tests show. Check: `route-planner.spec.ts`.
3. **Keys and buttons.** In `Planner`: a `keydown` listener on the document (cleaned on destroy) for `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, ignored in `input`, `textarea`, `select` and content-editable; two buttons in the panel with `planner.history.undo` and `planner.history.redo` keys (both languages) and the shortcut in the tooltip. Check: `planner.spec.ts`.
4. **Visual check and docs.** Chromium on a 30 km loop as in the brief. `CLAUDE.md` (planner section, one bullet) and `docs/architecture.md`. Full run once.

## Done

All four steps done. Checked in Chromium on a 30 km loop: a detour added (30.1 km to 40.5 km), Ctrl+Z (30.1 km, no request), Ctrl+Shift+Z (40.5 km, no request), profile changed to gravel (one request), Ctrl+Z (back to the 40.5 km route, no request). Step 3 also fixed an older case: an edit made before the previous one's route is in place now computes in full.
