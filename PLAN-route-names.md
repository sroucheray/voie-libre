# Plan — names of routes from their places (done 2026-11-11)

Brief: [BRIEF-route-names.md](BRIEF-route-names.md). One commit per step, after lint, build and the targeted tests.

1. **API.** `Place.short` (search: the place's own name, else the locality; reverse: the locality, else the name); schema; spec; `npm run generate-client`.
2. **Web: short names and the rule.** `FoundPlace.short`, `GeocodingService.reverse` returns the label and the short name, `PlannerStore.setLabel(point, label, short?)` and `shortOf`; the pure rule `planner/route-name.ts`; keys `saved.autoName.*`. Specs.
3. **Saved routes field.** The proposal from the rule with the fallback, kept live, stopped by a hand edit, reset when the route is cleared and after saving, the date on a clash. Specs.
4. **Docs and by-hand check.**

## Checked

Against the real API in the browser: two clicks, the proposal `Clermont-Ferrand → Issoire` arrives once both places are named; a name typed by hand stays after the route is reversed; the API gives `short` for a reverse lookup and a search. Specs for the rule, the field (follows, stops after a hand edit, empty field, reset on clear, date and number on a clash), the places lookup and the API.

Found on the way and fixed: when the end's name arrived, `PointNamer` cancelled the start's lookup still running and never asked again, so the start often stayed unnamed.

Not checked: touch; a place with no town in Photon's answer (the short name falls back on the place's own name or is absent).

Left as it is: a stop clicked on the map has no name (only the start and the end are looked up), so `via` appears only for a stop picked by search; routes already saved are not renamed.
