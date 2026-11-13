# Loops by duration, and alternatives in the map pop-up

Items 2 and 3 of the [backlog of 2026-11-12](next.md).

## Why

A runner thinks "one hour", a cyclist "three hours", not kilometres. And the number of alternative loops is only asked in the left panel, not where the loop is drawn.

## What done looks like

1. **Alternatives in the pop-up.** The loop dialog on the map (step "distance") has the same "alternatives" choice as the panel. The two stay in step (`store.alternatives`).
2. **Duration beside distance.** In the loop dialog and in the panel, the length of a loop by distance can be given as a distance or as a duration (a switch). With a duration, the target distance is `duration × speed`.
3. **Speed.** Each profile has a default speed (road 22 km/h, gravel 17 km/h, trail 8 km/h; to confirm on first use). A speed field next to the duration shows it and can be changed; the value is kept on the device per profile (local storage, never sent to the API). The API still receives a distance only: no API change.
4. **Climb ignored in v1.** The target distance does not depend on the climb. After the calculation the result shows the estimated duration at the chosen speed beside the distance, so the gap is visible.
5. **Saved with the route.** A loop saved by duration reopens as a loop by distance with the computed distance (nothing is recomputed on opening); the duration chosen is not stored.

## How we check

- Unit specs: duration to distance, default speed per profile, speed persistence, estimated duration of a result.
- Component specs: the switch in the dialog and the panel, alternatives in the dialog, both languages (the i18n test fails on a missing key).
- Manual run in the browser with the local stack: a 1 hour road loop, then trail, then a changed speed.

## What exists

`planner.loop.*` strings, `loopKm`/`loopAscent`/`loopDirection` signals and `drawLoopByDistance()` in `planner.ts`, the loop dialog and the panel fields in `planner.html`, `store.alternatives()`, `BRouterProvider.roundTrip`.

## Out of scope

- Climb in the duration (Naismith, Minetti); a pace in min/km for runners (a speed in km/h only, for now).
- Loops by duration for the modes "back" and "avoid outbound".

## Plan

1. **Duration maths.** A pure `loop-duration.ts` (default speeds, `distanceFor(duration, speed)`, `durationFor(distance, speed)`) with its spec.
2. **Speed setting.** A small store of the speed per profile on the device, with its spec.
3. **Dialog and panel.** The switch distance/duration and the speed field, strings in `en.json` then `fr.json`.
4. **Alternatives in the dialog.** The same select as the panel, bound to `store.alternatives`.
5. **Estimated duration on the result.** Shown beside the distance for loops.
6. **Docs.** `docs/implementation.md` (planner section), one line in `CLAUDE.md`, this file folded into "How it went".

Each step ends with lint, build and the targeted spec, then one commit.
