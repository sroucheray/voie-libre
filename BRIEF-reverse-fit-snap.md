# Voie Libre — Brief: reverse the route, wider removal, FIT export, points on ways, map layer proposals

Follow-up to [BRIEF.md](BRIEF.md), [BRIEF-local-edits.md](BRIEF-local-edits.md) and [BRIEF-map-interaction.md](BRIEF-map-interaction.md). Asked on 2026-11-10.

## Problem

1. The swap button of the panel exchanges the start and the end only; the stops keep their order, so the route is not the same trip the other way round.
2. Removing a stop recomputes 500 m of route on each side of it. On a real detour the route keeps most of the way to the removed stop.
3. Routes can only be exported as GPX. FIT is the native course format of most bike computers and watches.
4. A click anywhere puts a point there, even in the middle of a field. For road and gravel riding a point only makes sense on a way.
5. The map has one plain basemap. No relief, no imagery, nothing that shows which ways suit the selected profile.

## Who and where

The author, on desktop and on touch. Nothing may depend on hover.

## Scope

1. **Reverse the route.** The swap button reverses the whole list of points: the end becomes the start, the stops are visited in the opposite order. `PlannerStore.swapEnds` becomes `reverse`; the button's label becomes "Reverse the route" / "Inverser l'itinéraire".
   - A loop with stops is ridden the other way (same start, stops reversed); an "avoid the way out" loop keeps its mode. A loop without stops (plain or by distance) has nothing to reverse: the button is disabled, as today.
   - The route is computed again in full (one-way streets and climbs make the way back a different route). One step of undo. Place names follow their points, as today.
2. **Removing a stop recomputes between its two neighbours.** The stretch replaced goes from the point before the removed stop to the point after it, and the short `POST /route` goes from one to the other. The rest of the route is kept, and so are the other rules of a local edit (only the selected alternative is kept, totals from the kept parts, undo without a request).
   - Unchanged: removing the start or the end computes in full; a route not up to date with the points computes in full.
   - When the two neighbours are the same place (the only stop of a loop), the route is computed in full.
   - The special handling of a stop at the tip of a spur goes away: the wider stretch covers it.
3. **FIT export.** A saved route exports as a FIT course file, built on the device like the GPX (never by the API), downloaded through `FILE_DOWNLOADER`.
   - Content: `file_id` (course), `course` (name, sport from the profile: cycling or running), one `lap` (distance, climb, duration, both ends), timer start and stop events, one `record` per geometry point (position, elevation, distance, timestamp), one `course_point` per stop with its translated name.
   - Timestamps are made up from the route's estimated duration, spread along the distance (a course needs them). A route without elevation exports without elevation.
   - The encoder is written here (`apps/web/src/app/export/fit.ts`, pure, no runtime dependency): FIT is a small binary format (header, definition and data messages, CRC-16).
   - The "Export" button of a saved route offers the two formats (GPX, FIT). Shared-route links keep GPX only.
4. **Points on ways, for road and gravel.** On the Road and Gravel profiles, a point placed on the map (click, map menu, marker drop, waypoint pulled out of the route) snaps to the nearest way the profile can use, when one is close. When none is close, the point is refused and a short message says so ("No road close to this place" / "Pas de route près de cet endroit"); a refused drop puts the marker back.
   - Close means within 24 px on screen and within 100 m on the ground. Both figures are constants, to tune by hand.
   - Ways come from the basemap's vector tiles (`roads` layer of the Protomaps tiles): the zoom 14 tile around the point, read from the local archive, because the tiles of lower zooms leave the small roads out (decided on 2026-11-10, after measuring the archive). Snapping therefore works at every zoom, offline, and calls nothing. Road: roads and cycleways, no motorway, no path or track. Gravel: the same plus tracks and paths.
   - Trail: no snapping, the point stays where it is placed (running off the ways is allowed).
   - Not snapped: places picked from the search, "My position", imported GPX, points already placed (changing the profile moves nothing). Where the basemap has no tiles (outside the extract), the point is kept as placed: the routing engine still attaches it to its network, as today.
   - The ghost marker under the mouse shows the snapped place, so the user sees where the point will land.
   - During a live drag the place reported is the snapped one; where there is no way close, the route stays on the last valid place.
   - While the tile around a place is being read (the first time only), the ghost stays under the pointer.
5. **Map layers: proposals only.** A document, `docs/map-layers.md`, to choose from later. Nothing is built. For each proposal: what the user sees, where the data comes from and its licence, download size for the test region and for France, what it costs offline, effort, risks. It covers at least:
   - a layer switcher on the map (Angular, translated), and how layers and overlays combine;
   - relief from the Copernicus tiles already downloaded: hillshade, contour lines, slope shading, 3D terrain;
   - imagery as an option the user turns on, calling a public server (decision: the default basemap stays local; optional layers may call an external domain, said clearly in the switcher): IGN orthophotos for France, a global fallback, their terms of use;
   - ways that suit the selected profile: what the current tiles allow (road classes only) and what needs our own tiles (surface, track grade, cycle routes, trail difficulty, traffic class), with the tool to build them;
   - signed cycling and hiking routes as an overlay;
   - what is not possible with open data (popularity heatmaps).
     The document ends with a recommended order.

## Done, and how we check it

- Unit tests: `PlannerStore.reverse` (route, loop with stops, loop without, undo, names); `planLocalEdit` for a removal (window and points are those of the two neighbours; full compute for the cases above); the FIT encoder (header, CRC, and the file read back by a FIT decoder: sport, distance, number of records, first and last position, course points); the snapping rule (pure function: candidates, profile filter, both thresholds, refusal).
- The FIT decoder used in the test is `fit-file-parser` (MIT), a dev dependency only: never shipped in the app. Needs the author's go to install.
- By hand, on the local stack: reverse a route with two stops; remove a stop that is a 5 km detour and see the whole detour go; export a FIT file and open it in a FIT viewer (the author has no device: no on-device check); click 30 m from a road on Road (snaps), in a field (refused), the same on Trail (kept); drag a marker off the road.
- `en.json` and `fr.json` have every new key. Lint, build and the full test run pass once at the end.
- `CLAUDE.md` and `docs/architecture.md` describe the new behaviour.

## Constraints

- Stack and rules of `CLAUDE.md`: no hard-coded string, error codes translated, the map calls no external domain (the layers document may propose opt-in exceptions; nothing in this brief adds one).
- No new runtime dependency, except `@mapbox/vector-tile` and `pbf` to decode the tiles (agreed on 2026-11-10; both already come with MapLibre).
- One commit per step.

## Out of scope

- Building any map layer or the layer switcher.
- FIT import; FIT for shared links; turn-by-turn cues in the FIT file; checking on a Garmin or Wahoo device.
- Snapping through the routing engine or a new API endpoint; snapping on Trail; re-snapping existing points when the profile changes.
- Reversing a loop by distance (its direction is already a setting).
