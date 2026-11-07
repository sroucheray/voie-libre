# Voie Libre — Brief: map interaction

Follow-up to [BRIEF.md](BRIEF.md) (milestone 1, kept as is). This brief covers how the user places points on the map and makes a loop.

## Problem

- Nothing tells the user what the next click does (start, waypoint or end): two hint sentences in the panel, then silence.
- A loop is impossible unless the user guesses that the end can be put on the start.
- A new point always goes just before the end; a detour in the middle of the route cannot be added.
- Drag and right-click removal exist but are not discoverable, and right-click does not exist on touch.

## Who and where

The author, on desktop (mouse) and also on touch (phone, tablet; Android app later). Nothing may depend on hover alone.

## Scope

1. **Next-click ghost.** A translucent marker follows the pointer on desktop with the colour and label of the role the click will give (start, waypoint, end), plus a short action text. On touch there is no ghost: the help bar and distinct markers carry the meaning.
2. **Distinct markers.** Start, waypoint and end differ by colour and shape, not only by label. A loop shows one combined start/end marker.
3. **Contextual help bar** on the map, text depending on state (no point, one point, route computed) and recalling the gestures (drag to move, remove by right-click or long press).
4. **Loop.**
   - A "Loop" button from two points on.
   - A magnet on the start marker: near it, it grows and says "Close the loop"; a click closes it.
   - Closing asks the user how: *back to start* (end = start, computed by BRouter, **active**); *avoid going back the same way* and *generated loop by distance* are shown **disabled with "soon"** (they need server work: penalised segments, GraphHopper).
5. **Insert a point on the route.** Dragging the selected route creates a waypoint at the drop position, inserted at the right place in the order (the segment that was dragged), instead of "always before the end".
6. **Touch.** Long press on the map opens a small menu: set as start, add a stop, set as end. Long press on a marker removes it (with a confirmation or undo).

## Out of scope

Server-side avoid-the-outbound-path routing, distance-based loop generation, GraphHopper, undo/redo history, reverse direction, accounts.

## Constraints

- Fixed stack, no new dependency unless asked. All text through Transloco (`en.json`, `fr.json`).
- Keep the `PlannerMapDriver` seam: pure rules in `PlannerStore`, map code in `maplibre-driver.ts`, fake driver in tests.
- Loading a saved route must still never call `POST /route`.
- `MAX_POINTS` still applies.
- Accessible: the help text is real text (live region where it changes), ghost and magnet are `aria-hidden`; every map gesture has a panel equivalent.

## Done means

- Unit tests: store rules (roles, insert at the right index, close loop, max points, saved-route restore), driver contract with the fake driver, help-bar states, disabled loop options, i18n key parity.
- Visual check in the browser, mouse then emulated touch: ghost and its colours, markers, help bar per state, magnet, loop dialog, drag-to-insert, long-press menu.
- Lint, build, targeted tests pass, then one full run at the end; one commit per step.
