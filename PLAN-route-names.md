# Plan — names of routes from their places

Brief: [BRIEF-route-names.md](BRIEF-route-names.md). One commit per step, after lint, build and the targeted tests.

1. **API.** `Place.short` (search: the place's own name, else the locality; reverse: the locality, else the name); schema; spec; `npm run generate-client`.
2. **Web: short names and the rule.** `FoundPlace.short`, `GeocodingService.reverse` returns the label and the short name, `PlannerStore.setLabel(point, label, short?)` and `shortOf`; the pure rule `planner/route-name.ts`; keys `saved.autoName.*`. Specs.
3. **Saved routes field.** The proposal from the rule with the fallback, kept live, stopped by a hand edit, reset when the route is cleared and after saving, the date on a clash. Specs.
4. **Docs and by-hand check.**
