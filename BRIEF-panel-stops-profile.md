# Voie Libre — Brief: stops anywhere and a descriptive profile choice

Follow-up to [BRIEF.md](BRIEF.md) and [BRIEF-search.md](BRIEF-search.md). This brief covers two changes to the planner panel.

## Problem

1. In the panel, "Add a stop" always opens its empty field just before the end. To search a place for a stop between the start and the first stop, the user has to add it at the end and drag it up.
2. The profile is three radio buttons with one word each (Road, Gravel, Trail). Nothing says what each one does to the route.

## Who and where

The author, on desktop and on touch (Android later): nothing may depend on hover.

## Scope

1. **A "+" between every pair of fields.** Once the route has two points, a small "+" button sits between each pair of consecutive fields of the panel (start, stops, end), always visible. It opens an empty place field at that position; the field works like today's new-stop field (search, "My position", a cross to cancel, focus on open). Picking a place inserts the stop there (`PlannerStore.insertPoint`, so a local edit when the route is on screen, and one step of undo). Only one empty field is open at a time: another "+" moves it.
2. **The "Add a stop" button is removed.** The "+" before the end does its job.
3. **Limits as today.** No "+" under two points or at `MAX_POINTS`. On a loop the "+" works the same (a loop by distance loses its mode when a stop is added, as today).
4. **Reorder handle on the left.** The grip of a stop is hard to grab next to the remove button. It moves to the left of the field and the stop's number becomes part of it: one handle made of the grip dots and the number, with a touch target of 32 px at least and the `grab` cursor. The remove button stays alone on the right. The start, the stops and the end stay aligned on their markers. The text of the field can still be selected (only the handle starts a drag).
5. **Profile dropdown.** The radio buttons become a custom dropdown: a button showing the selected profile's title and description, opening a list where each option has its title and description, the selected one marked. Keyboard and screen-reader behaviour of a select-only combobox (ARIA `combobox` + `listbox`): Enter, Space or arrows open it, arrows move, Home/End, Enter or Space pick, Escape or a click outside closes without change, focus returns to the button.
6. **Wording** (Transloco keys in `en.json` and `fr.json`):

   | Profile | English | French |
   | --- | --- | --- |
   | Road / Route | Road bike: paved roads, the fastest way | Vélo de route : routes revêtues, au plus rapide |
   | Gravel / Gravel | Gravel bike: tracks and quiet roads | Vélo gravel : chemins et petites routes |
   | Trail / Trail | Running: footpaths and tracks first | Course à pied : sentiers et chemins d'abord |

## Out of scope

Any change on the map (the menu's "add stop", dragging the route), to the API, the routing profiles themselves or the store's rules. New profiles. The alternatives select stays native. A generic dropdown component for other uses.

## Constraints

- Fixed stack, no new dependency, no API or client change.
- No hard-coded UI string; both languages.
- Undo/redo keys stay ignored while the focus is in the dropdown, as in a select.
- The grip, reorder by drag and drop and the remove button of the stops keep working.

## Done means

- `planner.spec.ts`: a "+" between each pair of fields and none under two points or at the maximum; a place picked after the "+" between the start and the first stop is inserted at index 1, between two stops at the right index, before the end as before; cancel closes the field; no "Add a stop" button left.
- `planner.spec.ts`: the handle comes before the field and holds the number; dragging it onto another stop still reorders.
- A spec for the dropdown: shows title and description, opens and picks with mouse and keys, Escape keeps the value; `planner.spec.ts`: picking a profile calls `setProfile`.
- The i18n key test passes; lint, build and the full suite pass once at the end.
- Checked in Chromium: a route with two stops, a stop added between the start and the first stop through its "+", a stop moved by its handle, the profile changed through the dropdown (one request), in English and in French, at phone width.
