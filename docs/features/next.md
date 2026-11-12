# Backlog of 2026-11-12

Ideas noted after the first release (`v0.1.0`). Nothing here is started; each item needs a short brief before work begins.

## Items

1. **Welcome screen.** On the first visit, a screen explains what the app does and the two ways to start: an itinerary (points A to B) or a loop. It says the app is free and offers the donation (Liberapay link, `ABOUT_LINKS.donation`). It can be dismissed and found again (for example from the About window).
2. **Alternative loops on the map.** The number of alternative loops is asked in the loop pop-up on the map, not only in the left panel.
3. **Loop by duration.** A loop can be asked by time as well as by distance: a 1 hour run, a 3 hour ride. The duration is turned into a distance with the speed of the athlete, which depends on the profile (road, gravel, trail) and can be changed by the user. To decide: the default speeds, whether the speed takes the climb into account, and whether the duration is shown next to the distance on the result.
4. **Donation in the header.** A donation button in the top bar, beside the About button, linking to the same Liberapay page. To decide: how discreet it is on a phone, where the header is already tight.

## Constraints

- The rules of `CLAUDE.md`: no hard-coded label, local first (a speed is a setting kept on the device).
