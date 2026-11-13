# A clearer route panel

## Why

The route tab of the panel mixes everything in an order that does not follow the use: the profile, the places, the loop settings, the loop button and "Clear all" together, then the alternatives and "Compute the whole route again" before the result they concern, the list of routes, and at the very bottom "Save", out of sight under the list.

## What done looks like

Three blocks, in the order they are used, in the same simple design (white cards, the same buttons), each with a discreet title:

1. **Start and end.** The profile (one line), the places (start, stops, end, swap, "My position"), then the loop card "Make a loop" / "Close the loop". The loop settings (length or duration, climb, direction) of a loop by distance are in a folded group right under the card, whose title says the current length ("Loop settings: 30 km"); folded by default.
2. **Route** (only once there is a point). A header with the title on the left and, on the right and small, the number of alternatives and "Compute the whole route again" when it applies: they are about this result. Under it the loading text or the error, the cards of the routes, and the light profile on a phone.
3. **Actions bar**, pinned at the bottom of the panel card (outside the scrolling part), visible without scrolling: the save form (name and "Save", or the "Saved as…" notice) and "Clear all" as a small link beside it. Hidden when the sheet of a phone is only a peek.

Nothing else changes: same strings, same behaviour, same specs except for what moved.

## How we check

- Component specs: the order of the blocks, the loop settings folded and showing their length, the options in the result header, the actions bar outside the scrolling part and still reachable with a long list of routes.
- A look at the panel on a wide screen and on a phone-sized viewport, both languages.

## Out of scope

- A redesign of the place fields, of the profile choice, or of the loop dialog.
- Moving undo and redo (they stay at the top on a wide screen and on the map on a phone).

## How it went

Built in one pass instead of three commits (the three blocks touch the same part of the template). Two things beyond the brief: the save form (`saved-routes.scss`) puts the name and the button on one row, so the pinned bar takes about 125 px and not 180 on a phone; and `planner.scss` was at 11.9 kB of its 12 kB budget, so the phone rules moved to `planner-phone.scss`. Seen in the browser pane, a route being made through the search fields (no WebGL, so no map click): wide screen and phone half sheet.
