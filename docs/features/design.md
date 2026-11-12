# Voie Libre: design brief

Audit of the current interface: see the notes of the design session (`audit-design.md`); summary in "Why" below.

## Why

The interface is functional but unstyled: about 120 hard-coded colours in 26 values, one CSS custom property, native browser buttons next to custom components, no type scale, no logo. At 375 px the planner panel covers most of the map, buttons are 16 to 36 px high, and the top block (title, tagline, API status, offline buttons) is plain text. The map palette (route, ways, surface, grade bands) was chosen colour by colour with no system.

## For whom

The author today; later cyclists and trail runners riding and running between Angers and Lyon, who plan a route, check its profile and surface, keep it offline and export it.

## Direction

- **Mood**: sober and tool-like. Dense, very readable, neutral surfaces; the map and the route are the stars. One accent colour, used for the route, the primary action and the focus ring.
- **References**: Komoot (clean side panel), Organic Maps / CoMaps (utilitarian, offline), Strava / Ride with GPS (dense route tool), Google Maps / Apple Maps (bottom sheet on a phone).
- **Priority device**: desktop first (side panel over the map). The phone layout (bottom sheet, 44 px targets) is designed in the same pass, then Android through Capacitor reuses it.
- **Theme**: light only. Colours are CSS custom properties (tokens) so a dark theme can be added later without touching components; no dark theme in this work.
- **Identity**: a small drawn logo (SVG, a route that loops or a road bending) and a word mark "Voie Libre" in the header, plus the favicon and the app icon source. Designed in the mockups, kept only if the author likes it.
- **Scope**: the whole layout (header, panel, map controls, elevation profile, saved routes, offline, dialogs).

## What "done" looks like

1. Two or three directions as mockups (desktop and phone, with a route, the panel, the layer switcher, the profile with the surface bar, saved routes, offline); the author picks one.
2. Design tokens in `apps/web/src/styles.scss` (`:root` custom properties): colour (neutral scale, accent, status, route, map layers), type scale, spacing, radii, shadows, focus ring, minimum target size. No hex value left in a component `.scss`.
3. The map palette (ways, surface categories, grade bands, route, markers, hillshade) defined once in TypeScript and kept in step with the tokens (a test compares them, or the SCSS reads them), with a colour-blind check of the ways and surface sets.
4. Every component restyled with the tokens, native buttons and selects included, in the order of design.md#how-it-went.
5. At 375 px the map is usable: panel as a bottom sheet (peek / open), targets of at least 44 px, no horizontal scroll.
6. Checks: contrast of text at least 4.5:1 (3:1 for large text and icons), visible keyboard focus, `grep '#[0-9a-f]\{3,8\}'` in `apps/web/src/**/*.scss` returns nothing, lint, build and targeted tests pass at each step, screenshots at 375 and 1440 px compared with the mockup.

## Constraints

- No new dependency (no Angular Material, no Tailwind, no icon font): plain CSS with custom properties, inline SVG icons.
- Every label stays a Transloco key in `en.json` and `fr.json`; new strings (logo alt text, sheet handle) get both.
- No behaviour change: same features, same keys, same API. Tests that check behaviour keep passing; only selectors tied to markup may change.
- The map never calls an external domain (fonts included: no web font from a CDN; system fonts, or a font file served from the app if one is chosen).
- One commit per step, English conventional messages, lint + build + targeted tests first. No full test suite without the author's go.

## Out of scope

Dark theme, a design system documentation site, animations beyond simple transitions, redesign of features (new screens, new flows), the basemap's own style beyond its colours, marketing site, Android packaging.

## Decisions (phase 2, 2026-11-11)

Chosen from `docs/design/mockups.html` and `docs/design/mockups-c.html`: **direction C, variant C3 "Dossard"**.

- **Look**: green-tinted neutrals, deep green accent `#0f766e`, route `#0e7490`, large radii (14 px / 10 px), system rounded font (`ui-rounded`, then `system-ui`; no web font), light theme only.
- **Header**: solid green (`#0f766e`), white text, word mark "VOIE LIBRE" in heavy italic capitals with a speed-stripe underline.
- **Logo**: a race bib "VL" with speed lines, dark green on the green header; SVG, to be redrawn cleanly in phase 4 (shell step), also the source of the favicon and app icon.
- **Profile choice**: a three-button sport selector (Route, Gravel, Trail) with pictograms replaces the select-like combobox; the title and description keys (`planner.profile.<id>.*`) stay. The pictograms are hand-drawn SVG and are refined in the panel step.
- **Panel**: tabs (Itinerary, Saved, Offline) on desktop and in the phone bottom sheet; save and export actions at the bottom of the panel.
- Semantic map colours (ways, surface, grade bands) stay shared and are checked for colour-blind safety in the tokens step; the accent green is kept darker than the "good way" green on purpose.

## How it went

### Phase 1: audit and brief (done)

Audit written, interview done, brief written.

### Phase 2: mockups (no app code) (done: direction C3 "Dossard" chosen, see the brief)

1. **Three directions**: neutral sober (blue accent), sober with a warm accent, sober with a green accent. Each: desktop 1440 px and phone 375 px, a loaded route, panel, layer switcher, elevation profile with the surface bar, saved routes, offline panel, logo proposal. Made as static HTML pages (in `docs/design/`, no dependency) or in Figma if the author prefers.
2. **Choice**: the author picks one and lists changes; update the brief's open questions (accent, fonts, logo).

### Phase 3: tokens (done)

3. `styles.scss`: `:root` tokens (colour, type, spacing, radius, shadow, focus, target size) and a base layer (body font, headings, focus ring, native buttons and selects). Components untouched. `docs/design-tokens.md` lists them.
4. `core/map/palette.ts`: map colours defined once (route, selected and alternatives, preview, highlight, ways, surface, grade bands, hillshade, markers), used by `basemap-style.ts`, `way-levels.ts`, `surface-categories.ts`, `maplibre-driver.ts`, `GRADE_BANDS`; a spec checks that the values equal the CSS tokens. Colour-blind check recorded in the docs.

### Phase 4: components, one commit each (done; steps 9 and 10 share a commit)

5. Shell: green header with the "VL" bib logo and the italic word mark, language select, API status, offline entry points; app favicon and `theme-color`.
6. Panel and layout: desktop side panel; phone bottom sheet (peek and open states), 44 px targets, map visible.
7. Fields and buttons: sport selector (Route, Gravel, Trail pictograms, replaces the profile combobox), place fields, stops, undo/redo, alternatives, buttons (primary, secondary, danger, icon).
8. Map controls: zoom, layers switcher and legend, locate, help bar, markers, ghost marker, context menu, loop dialog.
9. Elevation panel: chart, grade legend, surface bar, notes, stretch stats.
10. Saved routes: cards, rename, export dialog, delete, import GPX.
11. Offline: area list, keep/cancel, estimates, update prompt, shared route page.

### Phase 5: close (done)

12. Sweep: no hex in `*.scss`, contrast and focus pass, screenshots at 375 and 1440 px, CLAUDE.md "Design" paragraph, docs updated. Ask the author before running the whole test suite once.
