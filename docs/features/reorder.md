# Voie Libre — Brief: reordering the stops, explicit about the drop

Follow-up to [backlog.md](backlog.md). Asked on 2026-11-11 (backlog item 5: "the drag and drop must be more explicit about the drop and what will happen").

## Problem

Stops are reordered in the panel with a grip, through the browser's native drag and drop. While dragging, the user only sees a blue line on the row under the pointer: not where the stop will end up, not its new number, not that the route is computed again on release. The native API also works badly with a finger and has no keyboard equivalent.

## Who and where

The author, on desktop and on touch. Nothing may depend on hover.

## Scope

1. **The list reorders live.** While a stop is dragged, it sits at the place it would take, the other stops move aside; the numbers stay as they are until the release, then follow the new order. The "+" between rows stay in place, out of use, so the list keeps its height. Releasing keeps that order; the route is computed on release only (one step of undo, as today).
2. **Say what happens.** While dragging, the help bar reads "Release to move the stop here; the route is computed again. Press Escape to cancel." (`planner.hint.reordering`). Escape (or a cancelled pointer) puts the stop back, with no request.
3. **Pointer events instead of native drag and drop.** One gesture for mouse and finger on the grip (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`; `touch-action: none` on the grip so the panel does not scroll under the finger).
4. **Keyboard.** The grip becomes a button: Arrow Up/Down moves the stop one place at once (a full recompute, undoable), focus stays on it, and a live region announces the result ("Waypoint 2 moved to position 1 of 3", translated).
5. Only stops are reordered; the start and the end stay where they are (the Start/End fields and the reverse button cover them).

## Done, and how we check it

- `planner.spec.ts`: during a drag the rows show the future order and numbers, nothing is computed before release, release reorders once, Escape restores, the help bar changes; arrow keys reorder and announce.
- By hand in the browser on the local stack: drag with the mouse, with Escape, and by keyboard; touch emulation if possible.
- `en.json` and `fr.json` have every new key. `CLAUDE.md` describes the new behaviour. Lint, build and targeted tests pass; the full suite runs once at the end, if the author asks.

## Constraints

- Rules of `CLAUDE.md`: no hard-coded string, no new dependency, one commit per step.

## Out of scope

- Reordering the start and the end; reordering by dragging on the map; any change to the markers' drag on the map.

## How it went

Built in 4 steps, one commit each: Pointer drag with live order; Keyboard; Styles; Tests and docs.

### Checked

In the browser on the local stack: a mouse drag of the first stop below the third (order changed once, one route), Arrow Down on a grip (stop moved, focus followed, announcement read). Not checked: touch, Escape by hand (tested in the spec), the live order seen during a drag (spec only).
