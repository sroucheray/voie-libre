# Colour of the route: plain, by surface, by grade

## Why

The selected route can be coloured by what it rides on (the surface layer), but the elevation profile's grade colours had no echo on the map. The user wanted the grade colours on the route, in place of or beside the surface ones.

## What done looks like

Proposal A, chosen: one choice for the colour of the route in the layers panel, three radios: **plain**, **by surface** (the default, as before) and **by grade**. One at a time, so the colours never mix. By grade uses the bands of the elevation profile, with the "Colour the descents" choice of each profile (descents neutral on road and gravel, coloured on trail) and its own legend in the panel. A route without elevation (an import) has no grade colours. The arrows stay on top.

The layers panel never runs out of the window: it takes the room down to the bottom of the window and scrolls inside when the window is short.

## How we check

- `MapLayers`: one colouring at a time, remembered, `surface: true` at first.
- `gradesToGeoJson` (runs of one band, descents neutral on request); the planner passes the grade colouring to the driver (and none for plain or surface); the panel's radios and the grade legend.
- A look at the real map with the layers panel open in a short window.

## Out of scope

- Both colourings at once (two bands side by side), kept as a possible fourth choice.

## How it went

`MapLayers` keeps `surface` and gains `grade` (stored beside it), and `routeColour` is derived from the two, so the storage and the surface code stayed as they were; `setSurface` and `setGrade` turn the other off. A second line layer (`planner-grades-line`) sits at the place of the surface one; its colours are `PALETTE.gradeLine`, the profile's bands with the first one deeper so that it shows on the map. Also fixed the layers panel: it was `content-box`, so its maximum height ran over by its padding.
