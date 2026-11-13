# Descent colours and the selection bubble on the profile

## Why

- The grade bands colour a descent like a climb (a 12 % descent is as orange as a 12 % climb), which reads as effort where there is none. Road and gravel riders read the colours as effort of the climbs; trail runners want the steep descents shown (they are hard on the legs and risky).
- Picking a stretch of the profile shows its figures under the chart and the zoom button beside them, far from the stretch.

## What done looks like

1. **Descent colours, per profile.** Road and gravel: descents take the neutral colour (the one of a nearly flat stretch), climbs keep their bands. Trail: descents are coloured as today. A switch "Colour the descents" in the open profile (beside the legend) changes it for the current profile; the choice is kept on the device for each profile (`localStorage`, `voie-libre.descent-colours`), never sent. It applies to the chart and to the light profile of the sheet.
2. **Selection bubble.** While a stretch is selected a bubble sits over the chart, by the selection (centred on it, kept inside the chart), with distance, ascent, descent and average grade on one line and the "Zoom on the map" button (icon, with its label and title). The sentence under the chart stays only for screen readers. Dragging, clicking or hovering the bubble never starts or ends a selection.

## How we check

- Specs: `gradeRuns` / `profilePaths` with descents neutral; the setting per profile (defaults, saved, per profile); the switch; the bubble (figures, zoom button, placed by the selection, ignored by the chart's pointer handlers).
- A look in the browser pane.

## Out of scope

- Colours of the route line on the map; the stretch details on the phone's light profile (it has no selection).

## How it went

Built as briefed in one commit. The switch sits beside the legend, not in the folded header (the header is a tap target that folds the profile). A descent that is not coloured takes band 0, so no new colour or CSS class was needed. Seen in the browser pane with a made-up route: the bubble over a selected descent, the descent pale, the switch unchecked on road.
