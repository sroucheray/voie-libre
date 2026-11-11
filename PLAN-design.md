# Voie Libre: design plan

Brief: [BRIEF-design.md](BRIEF-design.md). One commit per step, after lint, build and targeted tests. No full test suite without the author's go.

## Phase 1: audit and brief (done)

Audit written, interview done, brief written.

## Phase 2: mockups (no app code)

1. **Three directions**: neutral sober (blue accent), sober with a warm accent, sober with a green accent. Each: desktop 1440 px and phone 375 px, a loaded route, panel, layer switcher, elevation profile with the surface bar, saved routes, offline panel, logo proposal. Made as static HTML pages (in `docs/design/`, no dependency) or in Figma if the author prefers.
2. **Choice**: the author picks one and lists changes; update the brief's open questions (accent, fonts, logo).

## Phase 3: tokens

3. `styles.scss`: `:root` tokens (colour, type, spacing, radius, shadow, focus, target size) and a base layer (body font, headings, focus ring, native buttons and selects). Components untouched. `docs/design-tokens.md` lists them.
4. `core/map/palette.ts`: map colours defined once (route, selected and alternatives, preview, highlight, ways, surface, grade bands, hillshade, markers), used by `basemap-style.ts`, `way-levels.ts`, `surface-categories.ts`, `maplibre-driver.ts`, `GRADE_BANDS`; a spec checks that the values equal the CSS tokens. Colour-blind check recorded in the docs.

## Phase 4: components, one commit each

5. Shell: header with logo and word mark, language select, API status, offline entry points; app favicon and `theme-color`.
6. Panel and layout: desktop side panel; phone bottom sheet (peek and open states), 44 px targets, map visible.
7. Fields and buttons: profile select, place fields, stops, undo/redo, alternatives, buttons (primary, secondary, danger, icon).
8. Map controls: zoom, layers switcher and legend, locate, help bar, markers, ghost marker, context menu, loop dialog.
9. Elevation panel: chart, grade legend, surface bar, notes, stretch stats.
10. Saved routes: cards, rename, export dialog, delete, import GPX.
11. Offline: area list, keep/cancel, estimates, update prompt, shared route page.

## Phase 5: close

12. Sweep: no hex in `*.scss`, contrast and focus pass, screenshots at 375 and 1440 px, CLAUDE.md "Design" paragraph, docs updated. Ask the author before running the whole test suite once.
