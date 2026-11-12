# Design tokens

Source: `apps/web/src/design-tokens.css` (a `:root` block, loaded before `styles.scss`). Direction chosen in [the design brief](features/design.md): deep green accent, green-tinted neutrals, large radii, light theme only. Components read the tokens; no hex value belongs in a component stylesheet.

| Group       | Tokens                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour      | `--color-bg`, `-surface`, `-surface-2`, `-border`, `-text`, `-text-2`, `-accent` (+ `-hover`, `-ink`, `-soft`), `-danger` (+ `-soft`), `-header`, `-header-ink`, `-overlay`, `-tooltip` |
| Map         | `--map-route`, `--map-route-alternative`, `--map-route-highlight`, `--map-route-preview`, `--map-location`, `--map-marker-start/end/waypoint`                                           |
| Ways        | `--way-good`, `--way-fair`, `--way-avoid`                                                                                                                                               |
| Surface     | `--surface-paved`, `-cycleway`, `-unpaved`, `-path`, `-unknown`                                                                                                                         |
| Grade       | `--grade-0` to `--grade-4`                                                                                                                                                              |
| Type        | `--font-sans` (system rounded, no web font), `--font-size-xs` 0.75, `-sm` 0.8125, `-base` 0.875, `-md` 1, `-lg` 1.25, `-xl` 1.5 (rem)                                                   |
| Space       | `--space-1` to `--space-6` (0.25, 0.5, 0.75, 1, 1.5, 2 rem)                                                                                                                             |
| Shape       | `--radius-sm` 0.625 rem, `--radius-md` 0.875 rem, `--radius-pill`; `--shadow-1`, `--shadow-2`                                                                                           |
| Size, focus | `--target-min` 2.75 rem (44 px), `--focus-ring` (applied to every `:focus-visible` in `styles.scss`)                                                                                    |

## Map palette

MapLibre paints and chart inline styles cannot read custom properties, so the map and chart colours are defined once in `apps/web/src/app/core/map/palette.ts` and repeated in the tokens file. `palette.spec.ts` fails when a value of `PALETTE_TOKENS` differs from its CSS token. To change a colour, change both.

`project.json` sets `"loader": {".css": "text"}` so the spec can import the token file as text (`?raw`); no JavaScript imports a stylesheet otherwise.

## Colour-blind check

Distances (CIE Lab, Viénot simulation of protanopia, deuteranopia, tritanopia; below about 20 is hard to tell apart, 30 and above is fine for adjacent areas):

| Set                                               | Worst pairs after the change (before)                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Ways (good, fair, avoid)                          | good/avoid 27 (30), good/fair 43 (31), fair/avoid 45 (27)                                        |
| Surface (paved, cycleway, unpaved, path, unknown) | paved/cycleway 31, unpaved/path 38, paved/unknown 38 (cycleway/unpaved was 31, cycleway/path 32) |
| Grade bands                                       | 0/1 13, 2/3 25, 0/2 31 (before: 0/1 13, 2/3 21, 1/4 29)                                          |

Changes made from this: ways good `#039855`, fair `#fec84b` (lighter, so lightness differs from the green), avoid `#b42318`; cycleway blue `#2e90fa` instead of green; steepest grade bands `#f79009` and `#b42318`; path brown darker. The ways to avoid stay dashed. Grade 0/1 (pale blue, pale green) are close for everyone, but adjacent bands are also told apart by the chart's height and the legend order.

## Contrast (WCAG)

Text pairs are at least 4.5:1: text on surface 16.2, secondary text on surface 6.8 (on the page background 6.3, on `--color-surface-2` 6.1), white on accent and on the header 5.5, accent on surface 5.5, accent on its soft tint 4.8, danger on surface 6.6. The status dot on the header (3.7) and the route on the basemap land (4.7) pass the 3:1 bar for non-text.

## Icons

The interface icons (cross, plus, minus, swap, chevron, grip) are shapes of the [Lucide](https://lucide.dev) set, copied as data into `apps/web/src/app/core/icons/icons.ts` (no dependency) and drawn by `<vl-icon name="...">` (`core/icons/icon.ts`) or `iconElement()` for the map's markers. All share the 24 px grid and the 2 px round stroke; the size is `--icon-size` (1.25 rem by default) and the colour is the text colour. To add one, copy its paths from lucide.dev into `ICONS`. The map controls' layers and "My position" icons and the sport pictograms are still drawn by hand.

Lucide is distributed under the ISC licence, which asks that this notice is kept with copies:

> ISC License
>
> Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
>
> Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
