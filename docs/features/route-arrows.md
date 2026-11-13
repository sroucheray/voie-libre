# Direction arrows on the route

## Why

A route drawn on the map does not say which way it goes: out and back, or the way round a loop.

## What done looks like

Light chevrons, evenly spaced along the **selected** route, pointing the way it is ridden. Shown from zoom 11, a little larger as the zoom grows, white with a thin dark edge so that they read on the route colour and on the surface layer. The alternatives, the preview of a saved route and the highlighted stretch have none. They fade with the route while it recomputes.

## How we check

A look at the real map (a browser with WebGL): a route with its direction left to right shows the chevrons pointing right. No unit spec: the layer lives in the MapLibre driver, which tests replace with a fake.

## Out of scope

- An out-and-back: both directions overlap, so the chevrons of the way out and the way back sit on the same line (both ways shown). Offsetting the way back or a lighter tone is left for later.
- The direction on the elevation cursor.

## How it went

One symbol layer (`symbol-placement: line`, 80 px apart) over the selected route and its surface layer, with the chevron drawn once on a canvas (`arrowImage`) and added to the style again after each style change. First size too small to read: the chevron is drawn larger and `icon-size` runs from 1 to 1.4.
