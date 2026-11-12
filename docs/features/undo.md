# Voie Libre — Brief: undo and redo

Follow-up to [milestone-1.md](milestone-1.md) and [local-edits.md](local-edits.md). This brief covers going back on what was done to the route being planned.

## Problem

Nothing can be taken back, except the last removed point (a toast for a few seconds). After a click that moves a loop the wrong way, a profile change or a "clear all", the only way back is to redo the work by hand, and a recompute may not give the same route.

## Who and where

The author, on desktop (keyboard) and on touch (Android later, so buttons). Local first: history lives in memory only, is never stored or sent.

## Scope

1. **What is undone.** Every change to the route being planned: add, insert, move and remove a point, clear all, change of profile, of alternatives, of loop mode (close a loop, back to the start, avoid the way out, by distance) and of the length or climb of a loop by distance. Opening a saved or shared route and importing a GPX are **not** undone: they start a fresh history.
2. **What comes back.** The state before the change, with the route that was on screen then: points, profile, alternatives, loop mode, routes and selected alternative. Going back never calls `POST /route`: the computed route is kept in the history ("including recomputes": undoing a recompute gives the old route back as it was).
3. **Redo.** What was undone can be redone until a new change is made, which empties the redo stack.
4. **Depth.** 20 steps; the oldest is dropped.
5. **Keyboard.** `Ctrl+Z` / `Cmd+Z` undo; `Ctrl+Shift+Z`, `Cmd+Shift+Z` and `Ctrl+Y` redo. Ignored while the focus is in a text or number field or a select (the field keeps its own undo).
6. **Buttons.** An undo and a redo button in the planner panel, disabled when there is nothing to undo or redo, with translated labels and tooltips (Transloco keys in `en.json` and `fr.json`).
7. **Removal toast.** Stays as it is; its "undo" and the history both put the point back, and the history stays consistent with either.

## Out of scope

Persisting the history, undoing the selection of another alternative, undoing a save, share or delete of a stored route, undoing the map view (pan, zoom), a history list or panel.

## Constraints

- Fixed stack, no new dependency, no change to the API or the client.
- The state and the rules live in `PlannerStore` (snapshots, `undo`, `redo`, `canUndo`, `canRedo`); the key handling and the buttons in the `Planner` component. No network code in the history.
- A snapshot taken while a computation is in flight or in error keeps no route: undoing to it shows the points and computes them as for any change.
- Undoing while a request is in flight cancels it (the inputs changed, `RoutePlanner` already aborts), and the restored route must not trigger a computation.
- The first edit after an undo must still be able to be a local edit (see `local-edits.md`).
- Dragging a marker or the route is one step, not one per mouse move.
- No hard-coded UI string.

## Done means

- Unit tests (`planner-store.spec.ts`): each kind of change is undone and redone, the redo stack empties on a new change, depth capped at 20, a snapshot taken while loading keeps no route, loading a saved route resets the history, undo of a removal agrees with the toast.
- `route-planner.spec.ts`: no `POST /route` after an undo or a redo of a computed route; an edit after an undo is still a local edit.
- `planner.spec.ts`: keys do what they should, and are ignored in a field; buttons enabled and disabled correctly.
- Visual check in Chromium on a 30 km loop: add a detour, undo (back to the loop, no request), redo, change the profile, undo.
- Lint, build, targeted tests pass, then one full run at the end; one commit per step.

## Open points

- A change made while a recompute is still in flight (two quick edits) records a snapshot without a route for the second one: undoing to it computes. Acceptable for a first version.
- Not checked in the browser: touch use of the buttons, Cmd+Z on macOS.
- `Ctrl+Z` also happens in the elevation panel and on the map: no special case, the focus rule above is the only one.

## How it went

Built in 4 steps, one commit each: History in `PlannerStore`; RoutePlanner interplay; Keys and buttons; Visual check and docs.

### Done

All four steps done. Checked in Chromium on a 30 km loop: a detour added (30.1 km to 40.5 km), Ctrl+Z (30.1 km, no request), Ctrl+Shift+Z (40.5 km, no request), profile changed to gravel (one request), Ctrl+Z (back to the 40.5 km route, no request). Step 3 also fixed an older case: an edit made before the previous one's route is in place now computes in full.
