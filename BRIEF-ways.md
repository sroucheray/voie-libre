# Voie Libre — Brief: ways suited to the profile, on the map

Follow-up to [BRIEF-relief.md](BRIEF-relief.md) and proposal 3 of [docs/map-layers.md](docs/map-layers.md). Asked on 2026-11-11.

## Problem

The basemap draws every road the same way. For a given profile (Road, Gravel, Trail) some ways are ideal, some only possible, some to avoid, and the map does not say which.

## Who and where

The author, on desktop and on touch. Nothing may depend on hover; colour is never the only signal.

## Scope

1. **A layer "Ways for the profile"** in the switcher, next to "Relief": off by default, the choice kept on the device (`MapLayers`, same `localStorage` key, never sent).
2. **Three levels, from the current tiles** (`roads` layer, `kind_detail`; measured on the local archive: `trunk` is a `major_road`, motorways are `highway`):

   | Profile | Suited (green)                                                       | Possible (orange)                                                     | To avoid (red, dashed)                      |
   | ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
   | Road    | cycleway, residential, service, unclassified, tertiary               | primary, secondary, living street                                     | motorway, trunk (and their links)           |
   | Gravel  | track, path, bridleway, cycleway, residential, service, unclassified | tertiary, secondary, pedestrian, living street                        | motorway, trunk, primary (and their links)  |
   | Trail   | path, footway, track, bridleway, pedestrian                          | residential, service, unclassified, living street, cycleway, tertiary | motorway, trunk, primary, secondary (links) |

   Everything else (steps, platforms, rails...) is left as the basemap draws it. The "to avoid" lines are dashed, so the level does not rest on colour alone.

3. **The map follows the selected profile**: changing the profile restyles at once. A small legend (three swatches with their names) shows in the switcher while the layer is on.
4. Works offline (same tiles), no new data, no new dependency.

## Done, and how we check it

- Unit tests: the table (`wayLevel` per profile), the style (layers present only with a profile, above the roads and under the labels), `MapLayers` (default off, stored), `MapView` (checkbox, legend, restyle on profile change).
- By hand in the browser at zoom 13 to 15 around Clermont-Ferrand, on the three profiles.
- `en.json` and `fr.json` have every new key; `CLAUDE.md` and `docs/map-layers.md` updated. Lint, build and targeted tests pass.

## Constraints

- Rules of `CLAUDE.md`: no hard-coded string, the map calls no external domain.

## Out of scope

- Surface, track grade, traffic (proposal 7); small roads below zoom 12 (not in the tiles); changing which ways a point snaps to (`usableBy` stays as it is: it still accepts trunk roads on Road, for instance).
