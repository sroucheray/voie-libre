# The panel as a real sheet on a phone

Items 5 and 8 of the [backlog of 2026-11-12](next.md). The lighter profile in the drawer (item 6) and the full-screen map (item 7) come after, on top of this.

## Why

On a phone the panel is a bottom sheet that only toggles: a swipe opens it or closes it, with no sense of the finger moving it, and open it never covers the map. Moving between the map and the panel should feel like the map apps people already know.

## Decisions

- **Three heights** (the model chosen over a two-tab bar): _peek_ (handle and a one-line summary), _half_ (half of the stage, the map stays visible above) and _full_ (the whole stage under the header; the map is hidden).
- **Peek content**: the handle and one line: distance, climb and duration of the selected route, or the help text when there is no route yet. Nothing else, the map stays almost whole.
- **Not in this brief**: the lighter elevation profile inside the sheet (item 6) and a full-screen map without the header (item 7).

## What done looks like

1. The sheet follows the finger while it is dragged by its handle or its top band (no jump, no scroll of the page), and settles on release at the nearest height, with a short animation. A quick flick goes to the next height in its direction even if short.
2. A tap on the handle goes to the next height (peek, half, full, then back to peek); the handle is a button with its state announced and the arrow keys (up, down) move it too.
3. Automatic moves: the sheet goes down to peek when the map is touched while the sheet is at half (a tap on the map, a drag of the map, a long press that places a point), it rises to half when a search field or the loop dialog is focused, and a route computed from the map leaves it where it is.
4. In peek the summary line is the only content shown besides the handle (the tabs and fields wait for half).
5. On wider screens nothing changes (the panel stays a side panel).
6. `prefers-reduced-motion`: no animation, the sheet jumps.

## How we check

- Unit specs for the pure snapping rule (position, velocity, nearest height) and for the drag directive (live position, release, flick).
- Component specs: the three states, the tap cycle, the auto moves, the peek summary.
- Manual run on a phone-sized viewport with touch: drag slowly, flick, tap the map, focus a field; both languages.

## What exists

`Planner.sheetOpen` (a boolean), `vlVerticalSwipe` (`core/gestures/vertical-swipe.ts`, a swipe reported once), the `.panel`, `.sheet-handle` and `.panel--open` rules in `planner.scss` (max heights 4.25rem and 75%), the `sheet-open` host class that hides the elevation profile.

## Out of scope

- The elevation profile in the sheet, the full-screen map, a resizable profile.
- A bottom bar with tabs.

## Plan

1. **Snapping rule.** A pure `sheet-snap.ts`: the three heights from the stage height, `snapTo(height, velocity)` and `nextState(state)`, with its spec.
2. **Drag directive.** `vlSheetDrag`: pointer events, reports the live height and the release (height, velocity); a spec.
3. **State and layout.** `sheetState` (`peek` | `half` | `full`) in the planner replaces the boolean (`sheetOpen` becomes derived), CSS driven by a height variable, animation on release, tap and keys on the handle, reduced motion.
4. **Peek summary.** The one-line summary in the strings (`planner.sheet.*`, English then French).
5. **Automatic moves.** Down on the map touch from half, up to half on a field focus or the loop dialog.
6. **Docs.** `docs/implementation.md` (planner), one line in `CLAUDE.md` if the summary changes, this file folded into "How it went".

Each step ends with lint, build and the targeted spec, then one commit.
