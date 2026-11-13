# Direction arrows on the route

## Why

A route drawn on the map does not say which way it goes: out and back, or the way round a loop.

## What done looks like

Light arrows along the **selected** route, from zoom 11, a little larger as the zoom grows, fading with the route while it recomputes. The alternatives, the preview of a saved route and the highlighted stretch have none. Two kinds, by how each stretch is ridden:

- **Ridden one way** (most routes, the loop of a lollipop): a simple white chevron on the line, pointing the way it goes.
- **Ridden both ways** (an out-and-back, the stem of a lollipop): a pair of half arrows ⇌, harpoons in the route colour set on the right of each direction (a long thin stem and one short barb), so the way out and the way back lie on opposite sides of the line.

A stretch is "both ways" when most of it lies within 12 m of another part of the route going the other way (`directionRuns`, pure): the way back need not share the vertices of the way out. A stretch under 30 m between two of the other kind (the turn at the tip) takes the kind of its neighbours.

## How we check

- `route-direction.spec.ts`: single, out-and-back (same vertices, a few meters off, another road), a stem with a loop.
- A look at the real map (a browser with WebGL): a lollipop shows harpoons on both sides of the stem and chevrons on the loop; an out-and-back shows harpoons only. The layers live in the MapLibre driver, which tests replace with a fake.

## Out of scope

- The direction on the elevation cursor.

## How it went

First version: full chevrons on the line everywhere. They did not work for an out-and-back (both ways overlapped), so they became half arrows beside the line; five shapes were compared and the user picked the harpoon ⇁. Then the user asked for the two kinds above: chevrons where the route is one way, ⇌ where it is both ways. `directionRuns` samples every 8 m along each segment, finds a sample of another segment within 12 m going the other way (a grid of 12 m cells, so it stays fast), and marks a segment double when half of its samples match; the layers read a second source (`planner-route-direction`) of one line per run, with a `kind`. An adjacent segment counts too (the tip of an out-and-back is a U-turn).
