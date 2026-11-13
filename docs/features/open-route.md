# Building a route point by point

## Why

Today the second point is the end and every other point is inserted before it. To go from Clermont-Ferrand to the Col du Béal and then on to Pavezin, one has to know the end first, or move it after each new place.

## What done looks like

A route can be **open**: its last point is provisional, and the next place is added after it.

- **Map.** The first click sets the start, the second a stop (numbered 1, not "B"), the third another stop, and so on; each click extends the route after the last point. A small bubble on the last point says "Finish here". A click on it makes that point the end (B) and the route is **closed**: from then on a click inserts a stop between two points, as it does today.
- **Panel.** While the route is open the list reads: Start, Stop 1, Stop 2…, then an empty row "Next place…" where a place is searched (or "My position" picked) and added after the last. The last filled row carries a "Finish here" tick (same effect as the bubble). Once closed, the empty row gives way to "+ Continue", which opens the route again.
- **Phone.** The point is still put by a long press. The bubble has a large target, and "Finish here" is also in the summary of the folded sheet, in case the bubble is hidden by the sheet.
- **Open or closed.** Open when the points come from clicks on the map. Closed when the end is typed in its field or set from the map menu, when a saved route or a GPX is opened, and for a loop. A loop is never reopened.
- An open route is a valid route: it can be saved, exported and its profile read without finishing it.
- Undo removes the last added point (and brings back the state it had: open or closed); finishing and continuing are steps of history too. Only the last stretch is computed for a new point.
- A stop can still be inserted in an open route by dragging the line.

## How we check

- Store specs: open after clicks, append, finish, continue, undo of each, closed after `setEnd`, `closeLoop`, `loadSaved`.
- Planner specs: the panel rows and tick in both states; the bubble handler.
- A look in the browser pane at the panel (routes made through the search fields; no WebGL there, so the bubble is checked in its DOM only).

## Out of scope

- Reopening a loop; an "extend" mode that survives a reload (the flag is not saved with a route).
- Appending by dragging the line past the last point.

## Plan

1. Store: `open` flag, `appendPoint`, `finish`, `continue`, history.
2. Planner: clicks, "My position", fields, markers (the last point of an open route is a stop).
3. Panel: "Next place…" row, tick, "+ Continue", strings.
4. Map: the bubble in the driver, "Finish here" in the sheet summary.
5. Docs.
