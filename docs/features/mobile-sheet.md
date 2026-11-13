# The panel as a real sheet on a phone

Items 5, 6 and 8 of the [backlog of 2026-11-12](next.md). The full-screen map (item 7) comes after, on top of this.

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

## How it went

Built in 5 commits: the snapping rule (`sheet-snap.ts`); the drag directive (`sheet-drag.ts`); the three states and the height animation in the planner; the one-line summary of the closed sheet; the touch of the map taking the half-open sheet down.

### Changes from the brief

- The sheet does not rise by itself when a search field gets the focus: the fields are not shown at peek, so they cannot take the focus there. Choosing a tab raises it to half.
- A long press that places a point at half first takes the sheet down (the press starts with a touch of the map).
- With no route, the summary line says "Open to search a place or pick a profile" (the help bar above already tells how to place the start).
- Seen in the browser pane with emulated touch sizes: dragging, the three heights, the summary. The pane has no WebGL (no map), and its CSS transitions stall while the pane is hidden, so the animation itself is not seen; it is checked by the final heights only.

### Item 6: the light profile

A second commit pair added `ProfileMini` to the open sheet (curve plus one line of figures). The strip of the full profile under the map is no longer shown on a phone, only in the sheet. The strip's gradient shadow is gone on every screen (a plain 1 px top border, like the status bar). Not seen with a real route in the browser pane (no WebGL, so no route can be placed): checked by specs only. The `planner.scss` file is now at 11 kB of its 12 kB error budget: the next change to the planner styles should split it.

The same light profile (`compact`, curve only) also fills the folded profile bar on a wide screen, between the title and the chevron.

### Item 7: full screen

An `expand`/`shrink` button beside undo and redo (phone only) gives the map the whole screen: the header, the offline bar and the sheet go away, the map buttons and the same button stay. It hides the app's chrome only; the browser's full screen API was left out on purpose (not on iPhone Safari). Seen in the browser pane at phone size.
