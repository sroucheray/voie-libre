# Backlog of 2026-11-12

Ideas noted after the first release (`v0.1.0`). Nothing here is started; each item needs a short brief before work begins.

## Items

1. **Welcome screen.** On the first visit, a screen explains what the app does and the two ways to start: an itinerary (points A to B) or a loop. It says the app is free and offers the donation (Liberapay link, `ABOUT_LINKS.donation`). It can be dismissed and found again (for example from the About window).
2. **Alternative loops on the map** (briefed in [loop-duration.md](loop-duration.md)). The number of alternative loops is asked in the loop pop-up on the map, not only in the left panel.
3. **Loop by duration** (briefed in [loop-duration.md](loop-duration.md)). A loop can be asked by time as well as by distance: a 1 hour run, a 3 hour ride. The duration is turned into a distance with the speed of the athlete, which depends on the profile (road, gravel, trail) and can be changed by the user. To decide: the default speeds, whether the speed takes the climb into account, and whether the duration is shown next to the distance on the result.
4. **Donation in the header.** A donation button in the top bar, beside the About button, linking to the same Liberapay page. To decide: how discreet it is on a phone, where the header is already tight.

5. **Mobile drawer as a real sheet.** On a phone the panel follows the finger: dragging it up or down moves it with the pointer, it settles on release with an animation (a swipe flick decides the direction), and it can cover the whole map when fully open. Today the swipe only toggles it.
6. **Elevation profile integrated on mobile.** Keep the fold-out profile over the map as today, and add a lighter version inside the open drawer: smaller, with fewer figures (distance, ascent, descent; no stretch selection or zoom buttons).
7. **Full screen on mobile.** A way to hide the chrome (header, buttons, help bar) to give the map the whole screen, for example for checking a route on the move. To study: the real uses (browsing the map, following a route) and whether the browser's own full screen API is needed or a hidden header is enough.
8. **Moving between map and panel.** Proposals to compare in the brief, to make the change of mode as natural as possible on a phone:
   - three snap heights for the sheet (peek with the summary, half, full), as in common map apps, with the handle as the only control;
   - a tap on the route summary peeks the sheet up; a tap on the map lowers it to the peek;
   - the sheet goes to the peek by itself while the map is dragged or points are placed, and rises when a field is focused;
   - a bottom bar with two tabs (Map, Route) as a simpler alternative to the sheet;
   - the full-screen map mode (item 7) as a fourth state, left by a tap on a small button.

9. **Version in the About window.** The About window shows the version of the app (for example "Version 0.1.0"). To decide: where it comes from (the `v*` tag the deploy builds from, injected at build time, rather than a number kept by hand) and what a local development build shows.

## Constraints

- The rules of `CLAUDE.md`: no hard-coded label, local first (a speed is a setting kept on the device).
