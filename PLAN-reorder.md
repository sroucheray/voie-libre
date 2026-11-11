# Plan — reordering the stops (done 2026-11-11)

Brief: [BRIEF-reorder.md](BRIEF-reorder.md). One commit, after lint, build and the targeted tests (`planner.spec.ts`).

1. **Pointer drag with live order.** Replace the `dragstart`/`dragover`/`drop` handlers of `planner.ts`/`planner.html` by pointer handlers on the grip; a `reorder` signal (`from`, `to`) gives the displayed list (`shownStops`), the target place comes from the pointer's height against the other rows; release calls `PlannerStore.reorderPoint`; Escape and `pointercancel` reset. Help bar key `planner.hint.reordering`.
2. **Keyboard.** The grip is a `<button>`; Arrow Up/Down call `reorderPoint`, focus goes back to the moved stop's grip, a visually hidden `aria-live` text says the new position (`planner.points.moved`, `planner.points.move`).
3. **Styles.** The dragged row looks lifted (outline, shadow), no more blue top line; `touch-action: none` on the grip.
4. **Tests and docs.** Rewrite the "reordering the steps" tests; keys in `en.json`/`fr.json`; `CLAUDE.md`; mark the brief done.

## Checked

In the browser on the local stack: a mouse drag of the first stop below the third (order changed once, one route), Arrow Down on a grip (stop moved, focus followed, announcement read). Not checked: touch, Escape by hand (tested in the spec), the live order seen during a drag (spec only).
