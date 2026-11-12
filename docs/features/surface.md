# Voie Libre — Brief: surface and way type of the route

Follow-up to [ways.md](ways.md) and proposal 4 of [docs/map-layers.md](../map-layers.md). Asked on 2026-11-11.

## Problem

The route on screen says its length and climb, not what it rides on. For a road bike, a gravel bike or a runner, "how much of this is paved, how much is a track or a path" decides whether the route is the right one. BRouter knows it for every stretch (the `WayTags` of its messages: `highway`, `surface`, `tracktype`...); the API throws it away.

## Who and where

The author, on desktop and on touch. Colour is never the only signal.

## Scope

1. **Five categories** per stretch of the route, the surface before the way type:

   | Code | Category | Rule                                                                                                           |
   | ---- | -------- | -------------------------------------------------------------------------------------------------------------- |
   | `p`  | Paved    | a paved `surface` (asphalt, concrete, paving stones, paved...), or no surface on a road class (residential...) |
   | `c`  | Cycleway | `highway=cycleway`, unless its `surface` is unpaved                                                            |
   | `u`  | Unpaved  | an unpaved `surface` (gravel, compacted, dirt, ground, grass, sand...), or a `track` with no surface           |
   | `s`  | Path     | `path`, `footway`, `bridleway`, `steps` with no paved surface                                                  |
   | `?`  | Unknown  | nothing known                                                                                                  |

   The table lives in one place (`apps/api/src/routing/surface.ts`) and is easy to adjust.

2. **API.** `RouteResult.surfaces` and the `POST /route` response carry a string with one character per segment of the geometry (`geometry.length - 1`). Optional: a route without it (imported GPX, saved before this change, a shared route) simply has none. Everything that cuts or joins geometry keeps it in step: spur trimming, the "avoid the way out" loop, round trips. OpenAPI and the generated client are regenerated.
3. **Web: state.** `PlannedRoute.surfaces` (optional); local edits splice it like the geometry (`applyStretch`); saved routes store it (optional field, no version bump); undo and redo carry it with the route.
4. **Web: under the profile.** A bar under the elevation chart, aligned on the distance of the chart, one colour per category, with the share of each in a legend ("82 % paved, 14 % unpaved...", translated, with the length). Hidden when the route has no surfaces. Hovering or moving the cursor on it moves the shared cursor like the chart does (nothing may depend on hover: the legend is text).
5. **Web: on the map.** A checkbox "Surface of the route" in the layer switcher, off by default and kept on the device (`MapLayers`): the selected route is drawn in the colours of the categories, and the legend appears in the switcher. Alternatives keep their colour.

## Done, and how we check it

- API unit tests: the classification table, parsing of recorded BRouter messages (a fixture), trimming and joining keep `surfaces` the right length; the live integration spec checks a real route (length, categories present).
- Web unit tests: splice in `applyStretch`, saved route round trip, the bar and its legend, the checkbox and the route colours (fake driver).
- By hand in the browser on the local stack: a road route, a gravel route with tracks, a local edit (add a stop, remove one), save and reopen, with the layer on and off.
- `en.json` and `fr.json` have every new key; `CLAUDE.md`, `docs/architecture.md`, `docs/map-layers.md` updated. Lint, build and targeted tests pass; `npm run generate-client` leaves no diff after the regeneration commit.

## Constraints

- Rules of `CLAUDE.md`: no hard-coded string, error codes unchanged, never edit the generated client by hand, no new dependency.
- One commit per step.

## Out of scope

- Grade of tracks (`tracktype`), smoothness, cycle route networks (proposal 7); showing surfaces for imported GPX files or shared links; coloured alternatives; exporting surfaces to GPX or FIT.

## How it went

Built in 5 steps, one commit each: API: classify and carry; Web: state and storage; Web: the bar and the legend; Web: the route on the map; Docs and by-hand check.

### Checked

Against the live stack: `POST /route` for a gravel route returns 490 codes for 491 points (paved, cycleway, unpaved and path present); the recorded real BRouter spec and the opt-in integration spec (a route and an "avoid the way out" loop); in the browser, the bar and its legend under the chart, the route coloured on the map from the switcher, and an added stop (local edit) leaving 822 codes for 823 points.

Not checked: touch; saving and reopening a route by hand (the spec does it); a round trip by distance (the integration spec covers loops by the way out only).

Left as it is:

- Cobbles count as unpaved or rough though they are paved: a rough ride, which is what the category tells.
- Imported files, shared links and routes saved before this change have no surface bar: they say so and offer "Calculate the surface", which computes the route again between its points (the result can differ from the stored track, an imported one included; Undo brings it back). Found when the author turned the layer on over a route saved earlier. A saved loop by distance (start = end, its mode is not stored) cannot be calculated again: it says so and offers no button; a failed recalculation keeps the saved route on screen (the first version of the button wiped it: found by the author, reproduced with a real click on a saved loop).
- The surface is not carried to the GPX or FIT export.

After that, the loop mode is saved with the route (`SavedRoute.loop`, optional, no version bump), so a loop saved from now on can be calculated again; the six routes saved before keep no mode. Checked in the browser: a loop by distance planned, saved, the page reloaded, the route opened with no request and its mode back, then calculated again with one request (the test route was deleted afterwards).
