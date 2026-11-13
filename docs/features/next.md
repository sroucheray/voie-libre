# Backlog of 2026-11-12

Ideas noted after the first release (`v0.1.0`). Nothing here is started; each item needs a short brief before work begins.

## Items

1. **Welcome screen.** _Done (2026-11-13)._ On the first visit, a screen explains what the app does and the two ways to start: an itinerary (points A to B) or a loop. It says the app is free and offers the donation (Liberapay link, `ABOUT_LINKS.donation`). It can be dismissed and found again (for example from the About window).
2. **Alternative loops on the map** _Done_ (briefed in [loop-duration.md](loop-duration.md)). The number of alternative loops is asked in the loop pop-up on the map, not only in the left panel.
3. **Loop by duration** _Done_ (briefed in [loop-duration.md](loop-duration.md)). A loop can be asked by time as well as by distance: a 1 hour run, a 3 hour ride. The duration is turned into a distance with the speed of the athlete, which depends on the profile (road, gravel, trail) and can be changed by the user. To decide: the default speeds, whether the speed takes the climb into account, and whether the duration is shown next to the distance on the result.
4. **Donation in the header.** _Done (2026-11-13)._ A donation button in the top bar, beside the About button, linking to the same Liberapay page. To decide: how discreet it is on a phone, where the header is already tight.

5. **Mobile drawer as a real sheet.** On a phone the panel follows the finger: dragging it up or down moves it with the pointer, it settles on release with an animation (a swipe flick decides the direction), and it can cover the whole map when fully open. Today the swipe only toggles it.
6. **Elevation profile integrated on mobile.** Keep the fold-out profile over the map as today, and add a lighter version inside the open drawer: smaller, with fewer figures (distance, ascent, descent; no stretch selection or zoom buttons).
7. **Full screen on mobile.** A way to hide the chrome (header, buttons, help bar) to give the map the whole screen, for example for checking a route on the move. To study: the real uses (browsing the map, following a route) and whether the browser's own full screen API is needed or a hidden header is enough.
8. **Moving between map and panel.** Proposals to compare in the brief, to make the change of mode as natural as possible on a phone:
   - three snap heights for the sheet (peek with the summary, half, full), as in common map apps, with the handle as the only control;
   - a tap on the route summary peeks the sheet up; a tap on the map lowers it to the peek;
   - the sheet goes to the peek by itself while the map is dragged or points are placed, and rises when a field is focused;
   - a bottom bar with two tabs (Map, Route) as a simpler alternative to the sheet;
   - the full-screen map mode (item 7) as a fourth state, left by a tap on a small button.

9. **Version in the About window.** _Done (2026-11-13)._ The About window shows the version of the app (for example "Version 0.1.0"). To decide: where it comes from (the `v*` tag the deploy builds from, injected at build time, rather than a number kept by hand) and what a local development build shows.

10. **Route with direction arrows.** Arrows along the route line show which way it goes: out and back, or the way round a loop. Proposals to compare: small chevrons repeated every N pixels along the line (a MapLibre symbol layer with `symbol-placement: line`, hidden at low zoom); arrows only on the selected alternative; on an out-and-back, the way back drawn slightly offset or in a lighter tone so both directions can be told apart. To decide: density, colour over the surface layer, and whether the elevation cursor should also show the direction.
11. **Building a route point by point (exploration).** Today the route starts from a start and an end, then stops are inserted between them. The wish: go from Clermont-Ferrand to the Col du Béal, then on to Pavezin, without knowing the end first. To explore: an "extend the route" mode where each click or search adds a leg after the current last point, which becomes the end (what the stops do, but appended, with the end moving); a clear way to tell "add after the end" from "insert between" on the map (the ghost marker already says which role the next click has); how it works on a touch screen and with a loop; how undo and the elevation profile behave. Output of the exploration: a short brief with one recommended design.
12. **Descents too coloured on the profile.** The grade bands colour descents like climbs, which disturbs people who read the colours as effort. Proposals: (a) no colour on descents (neutral grey or the plain fill), colours for climbs only; (b) keep a descent colour but pale and in one hue (a light blue), without the steep levels; (c) a toggle "Colour the descents" in the profile header, off by default; (d) colour by effort (climbs by grade, flat neutral, descents neutral) and keep the grade figure in the stretch details. The recommendation is (a) with (c) as an option for those who want the descents back. The same choice applies to the colours of the route line if it ever uses grades.
13. **Resizable elevation profile.** On the map the profile becomes a drawer whose height the user changes by dragging its top edge (with keys on the handle), remembered on the device. Its content follows the height: very low, only the thin curve and the cursor figure; medium, the curve with the axes and the grade bands; tall, add the surface bar, the stretch details and the zoom buttons. To decide: minimum and maximum heights (a share of the screen, as the 45 dvh cap today), how it combines with the mobile sheet (items 5 and 6) and a snap to three heights as for the sheet.
14. **Draw-the-loop button text off-centre (fix).** In the loop dialog, the text of "Draw the loop" is not centred in its button. Small CSS fix: check `.loop-choice` (text-align, the `strong` inside, flex centring) in both the dialog and the panel.

## Constraints

- The rules of `CLAUDE.md`: no hard-coded label, local first (a speed is a setting kept on the device).
