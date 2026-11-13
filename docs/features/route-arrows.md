# Direction arrows on the route

## Why

A route drawn on the map does not say which way it goes: out and back, or the way round a loop.

## What done looks like

Light arrows along the **selected** route, from zoom 11, a little larger as the zoom grows, fading with the route while it recomputes. The alternatives, the preview of a saved route and the highlighted stretch have none. Two kinds, by how each stretch is ridden:

- **Ridden one way** (most routes, the loop of a lollipop): an arrow like the Unicode → on the line, pointing the way it goes.
- **Ridden both ways** (an out-and-back, the stem of a lollipop): a ⇄ on the line, the same arrow twice, one each way. It reads the same turned half a turn, so it needs no orientation. The way back of such a stretch draws nothing of its own (`echo`): one ⇄ stands for the two passes.

All arrows sit on the route line, none beside it. Both are white with a thin dark edge, a long thin stem and an open head, so that the two look alike.

A stretch is "both ways" when most of it lies within 12 m of another part of the route going the other way (`directionRuns`, pure): the way back need not share the vertices of the way out. A stretch under 30 m between two of the other kind (the turn at the tip) takes the kind of its neighbours.

## How we check

- `route-direction.spec.ts`: single, out-and-back (same vertices, a few meters off, another road), a stem with a loop.
- A look at the real map (a browser with WebGL): a lollipop shows harpoons on both sides of the stem and chevrons on the loop; an out-and-back shows harpoons only. The layers live in the MapLibre driver, which tests replace with a fake.

## Out of scope

- The direction on the elevation cursor.

## How it went

First version: chevrons on the line everywhere, which failed for an out-and-back; then half arrows beside the line (five shapes compared, the harpoon ⇁ chosen); then chevrons for one way and harpoons for both ways. The user then asked for Unicode-like arrows that look alike, all on the route: → for one way and ⇄ for both ways, both from one drawing routine (`drawArrows`). `directionRuns` samples every 8 m along each segment, finds a sample of another segment within 12 m going the other way (a grid of 12 m cells, so it stays fast), and marks a segment double when half of its samples match; the second pass over a double stretch is `echo`. The layers read a second source (`planner-route-direction`) of one line per run, with a `kind`. Seen on the real map with a made-up lollipop: ⇄ along the stem, → along the loop.
