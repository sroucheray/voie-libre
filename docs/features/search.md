# Brief: start and end search

## What and for whom

Two search fields at the top of the planner panel, Start and End, that resolve addresses and places, with a button to swap them, like a route search in a maps app. For the author, the only user at launch.

## Done means

- Typing in Start or End (two characters or more, 300 ms debounce) lists up to 6 suggestions; picking one (click, arrows and Enter) sets the first or last point, names it and moves the map there.
- The swap button exchanges the start and the end (the stops stay); it is disabled for a single point or a loop. It is one undoable step.
- A point placed any other way (click, menu, drag, "My position") shows the address found for it in its field; the coordinates show until it arrives, or when it fails.
- The fields replace the old list of points; only the stops between the two stay listed (reorder by drag and drop, remove).
- Offline, the fields are disabled with an explanation and no address is asked. The End field waits for a start.

## Decisions

- Provider: the public Photon server (`GEOCODER_URL`), called by the API only (`GET /geocode`, `GET /geocode/reverse`, rate limited); the browser never calls a geocoder, and the map still never calls an external domain.
- The `Geocoder` interface lets an own Photon instance replace the public one.

## Out of scope

Self-hosted Photon, search history, searching stops, categories or points of interest filters, storing place names in saved routes (a restored route shows coordinates until its ends are named again).

## Checks

API: `geocoding/photon-provider.spec.ts`, `routes/geocoding.spec.ts`. Web: `planner-store.spec.ts`, `search/geocoding.service.spec.ts`, `planner.spec.ts` ("start and end search", "offline"). Manual: needs network for Photon.
