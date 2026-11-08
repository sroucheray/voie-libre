# Voie Libre — Brief: user position on the map

Follow-up to [BRIEF.md](BRIEF.md). This brief covers showing the user's own position on the map when they choose to share it.

## Problem

The user cannot see where they are on the map, so placing a start point or checking a route against their surroundings means panning by hand.

## Who and where

The author, on desktop and on touch (phone, tablet; Android app later through Capacitor). Local first: the position is read by the browser and **never sent to the API, stored, or logged**.

## Scope

1. **"Locate me" button** on the map (Angular element, translated, keyboard reachable). A click asks the browser for permission, then shows the position and centres the map on it once.
2. **Position marker.** A blue dot with a translucent accuracy circle (radius from `coords.accuracy`), drawn through the `PlannerMapDriver` seam. It updates continuously while active (`watchPosition`) and does not recentre the map after the first fix.
3. **Heading.** When the device provides a heading (`coords.heading`, or compass events where available), the dot shows a direction cone. No cone when the heading is unknown or the user is still.
4. **Stop.** Clicking the button again stops watching and removes the marker.
5. **Use as start or stop.** An entry "My position" in the map menu and a button in the panel set the start (or add a stop, following `nextRole`) at the current position. Disabled while there is no fix.
6. **States and errors.** Button shows idle, searching and active. Permission denied, unavailable and timeout are stable codes translated under `geolocation.errors.*`; the planner stays fully usable. Insecure context (no HTTPS and not localhost) disables the button with an explanation.

## Out of scope

Recording a track, follow/navigation mode with auto-recentring, sending or saving the position, background tracking, imperial units.

## Constraints

- Fixed stack, no new dependency. All text through Transloco (`en.json`, `fr.json`, parity test).
- Browser API behind an injection token (`GEOLOCATION` provider) so tests use a fake and Capacitor can swap in its plugin later.
- Pure rules in a store (`LocationStore`: status, fix, errors); map drawing in `maplibre-driver.ts`; fake driver in tests.
- Loading a saved route must still never call `POST /route`; the dot is independent of the planned route.
- Accessible: the button has a pressed state and label, status changes go through a polite live region, the marker is `aria-hidden`.
- The map must still never call an external domain.

## Done means

- Unit tests: location store (states, errors, accuracy, heading, stop), button states, "My position" menu entry and panel button (disabled without fix, sets start/stop at the fix), driver contract with the fake driver, i18n key parity.
- Visual check in Chrome with a mocked geolocation (DevTools sensors): button states, dot, accuracy circle, cone, denied error, set as start.
- Lint, build, targeted tests pass, then one full run at the end; one commit per step.
