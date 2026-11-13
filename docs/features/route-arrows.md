# Direction arrows on the route

## Why

A route drawn on the map does not say which way it goes: out and back, or the way round a loop.

## What done looks like

Light half arrows, harpoons like ⇁ (a long stem and one short barb), evenly spaced along the **selected** route, pointing the way it is ridden and set beside the line, on its right-hand side (the barb side). On an out-and-back the way out and the way back are on opposite sides of the same line, so both directions read. Shown from zoom 11, a little larger as the zoom grows, in the route colour with a white edge so that they read on the map. The alternatives, the preview of a saved route and the highlighted stretch have none. They fade with the route while it recomputes.

## How we check

A look at the real map (a browser with WebGL): a route with its direction left to right shows the chevrons pointing right. No unit spec: the layer lives in the MapLibre driver, which tests replace with a fake.

## Out of scope

- The direction on the elevation cursor.

## How it went

One symbol layer (`symbol-placement: line`, 80 px apart) over the selected route and its surface layer, with the chevron drawn once on a canvas (`arrowImage`) and added to the style again after each style change. First size too small to read: the chevron is drawn larger and `icon-size` runs from 1.2 to 1.6.

First version: full chevrons on the line. They did not work for an out-and-back (both directions overlapped on the same line), so they became half arrows beside the line (`icon-offset` `[0, 12]`, in the icon's own frame, which turns with the line: its "down" is always the right of the way ridden). Seen on a made-up out-and-back: right-going arrows on one side, left-going on the other.

The first half arrow (stem and a long barb) was judged ugly; five shapes were compared and the user picked the harpoon ⇁: a long thin stem with one short barb.
