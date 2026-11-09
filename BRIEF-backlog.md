# Brief: backlog of 2026-11-08

## For whom

The author, the only user at launch, planning rides and runs on the website.

## What is asked

The seven items noted in the backlog of `PLAN.md`: two bugs and five features.

## Done means

1. **Three alternatives.** Asking for 3 alternatives from 30 rue Francis de Pressensé (Clermont-Ferrand) to Pavezin (Loire) shows routes, like 1 or 2 do. When the engine finds fewer alternatives than asked, the ones found are shown; an error comes only when there is no route at all.
2. **Map tiles.** After moving the map, every visible tile is drawn; none stays stale or missing.
3. **Stops by address.** Each stop is a search field between Start and End, like those two. It can be changed by search, reordered by drag and drop and removed. An "Add a stop" button inserts an empty field before the end. A stop set by a click on the map shows its coordinates (no address lookup for stops, as today).
4. **My position in the fields.** Focusing an empty Start, End or stop field offers "My position" as the first choice; picking it sets that point from the device position. The position stays in memory, as today.
5. **Loop direction.** A loop by distance takes a preferred direction: none or one of 8 compass points, chosen in the loop dialog and editable in the panel. The loop heads that way. Other loop modes are unchanged.
6. **Elevation profile.** Dragging over the chart selects a stretch and shows its distance, ascent, descent and average grade; the stretch is highlighted on the map; a click or Escape clears it. The chart is coloured by grade bands. The route line on the map keeps its colour.
7. **Live drag.** While a marker is dragged (or the route line, to insert a point), the route is recomputed as the pointer moves. Escape during the drag puts the point and the route back. After the drop, Ctrl/Cmd+Z undoes it in one step.

## How we check

- Unit and component specs for each item; the whole suite, lint and build once at the end; regenerating the client leaves no diff.
- Bugs 1 and 2 are reproduced first against the local stack (BRouter, tiles, a browser with WebGL), then checked again after the fix.
- A manual run in the browser for the features that touch the map (live drag, profile selection, loop direction).

## What exists

`PlaceField`, `PlannerStore` (points, labels, undo, local edits), `RoutePlanner` (debounce, abort), `LocationStore`, `BRouterProvider.roundTrip`, `buildProfile` and `ElevationPanel`, `OfflineFirstSource`.

## Constraints

- The rules of `CLAUDE.md`: no hard-coded label, stable error codes, generated client, the map never calls an external domain, the position is never stored or sent (except the address lookup the fields already do).
- Live drag must not flood BRouter: calls are throttled, stale ones aborted, and stay under the route rate limit.

## Out of scope

- Grade colours on the route line of the map.
- A direction for loops other than by distance.
- Address lookup for stops set by a click; place names in saved routes.
- A toast after a drag; cancelling a drag on a touch screen other than by the undo button.
