# Voie Libre — Brief: local edits of a route

Follow-up to [BRIEF.md](BRIEF.md) and [BRIEF-map-interaction.md](BRIEF-map-interaction.md). This brief covers reshaping a route slightly without losing the rest of it.

## Problem

Adding a point to a route recomputes the whole path. On a loop by distance this is worst: the loop has only the start twice, its shape comes from BRouter's round trip, so a single added point turns it into `[start, X, start]` and the original loop is lost. The same happens, less visibly, on any route: moving or removing a point reroutes everything.

## Who and where

The author, on desktop and on touch. Local first: nothing new is stored or sent beyond the `POST /route` calls the planner already makes.

## Scope

1. **Local recompute.** Adding a point (click, menu, drag of the selected route to insert one), moving a point and removing a point only recompute a short stretch of the selected route. The rest of the geometry is kept exactly as it was.
2. **Short window.** The stretch replaced is centred on where the point meets the route: from `max(500 m, 2 × distance from the point to the route)` before to the same after (clamped to the previous and next visible points, and to the ends of the route). The new stretch is one `POST /route` of three points (route vertex before, the point, route vertex after) with one alternative.
3. **Points beside the route.** A point placed next to the route makes a detour: the route leaves it before the point and rejoins it after, replacing only the window above. A point on the route only reshapes the window locally.
4. **Every route.** Same behaviour for loops (by distance, avoiding the way out, back to the start), A to B routes, saved routes, shared routes opened from a link and imported GPX files. Where the route has no computed geometry, the current full recompute stays.
5. **Alternatives.** The first local edit keeps only the selected alternative; the others are dropped. Changing the profile or the number of alternatives recomputes everything from the visible points, as today.
6. **Totals.** Distance, climb and duration of the edited route are updated from the kept parts plus the new stretch, so the panel and the elevation profile stay right.

## Out of scope

Hidden anchors or visible handles along the route, per-segment profiles, local edits on the API side (no new endpoint), undoing more than the existing remove-point toast, keeping the other alternatives after an edit.

## Constraints

- Fixed stack, no new dependency, no change to the API or the generated client.
- Pure rules (window, projection, splice, totals) in a pure module with its own spec; `PlannerStore` holds state; `RoutePlanner` does the network with a debounce and aborts stale requests.
- Loading a saved or shared route must still never call `POST /route`; the first edit afterwards makes the only call, for the window.
- A failed local request leaves the route as it was and shows the translated `planner.errors.*` code; nothing is lost.
- No hard-coded UI string; Transloco keys in both languages if anything new is shown.
- The map must still never call an external domain.

## Done means

- Unit tests: window and clamping, projection of a point beside the route, splice and totals, add / move / remove on a loop and on an A to B route, exactly one `POST /route` of three points per edit, geometry outside the window unchanged, failed request keeps the route, profile change recomputes everything.
- Visual check in Chromium on a 30 km loop by distance: add a point on it and beside it, the rest of the loop does not move.
- Lint, build, targeted tests pass, then one full run at the end; one commit per step.

## Open points

- Two edits made before the first answer arrives compute the whole route (the route on screen is not up to date with the points yet).
- Removing the waypoint at the tip of a spur routes between a place 500 m before and after it: the result can be a little longer than the route before the detour (28.7 km against 27.9 km on the 30 km loop checked in Chromium).
- The window factor (`2 ×`) and floor (`500 m`) are first guesses; adjust after the visual check.
- Dropping the other alternatives on the first edit is an assumption; say so if you would rather keep them hidden and restore them.
