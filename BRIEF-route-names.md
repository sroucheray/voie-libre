# Voie Libre — Brief: names of routes from their places

Follow-up to [BRIEF-search.md](BRIEF-search.md). Asked on 2026-11-11.

## Problem

A route is saved as "Road, 41 km": the profile and the length, which the list of saved routes already shows next to the name. Nothing tells which route it is.

## Scope

1. **A proposed name from the places.** The name field of "Saved routes" proposes (editable, as today):
   - an out-and-back or one-way route: `Clermont-Ferrand → Issoire`;
   - a loop (start = end): `Loop around Clermont-Ferrand` / `Boucle autour de Clermont-Ferrand`;
   - a route whose two ends are in the same place: `Around Clermont-Ferrand` / `Autour de Clermont-Ferrand`;
   - with one stop whose name is known: `Clermont-Ferrand → Lyon via Thiers`; with two stops or more: `Clermont-Ferrand → Lyon via 3 stops` / `via 3 étapes`;
   - the length and the profile are not in the name (the list shows them);
   - when a name is missing (offline, a lookup failed, a route that was opened or imported), the proposal falls back to today's `Road, 41 km`.
2. **Which name for a place.** The API gives each place a short name next to its label (`Place.short`): for a place picked by search, its own name (`Puy de Dôme`, `Issoire`); for the address found for a click, the locality (town, village or district), never the street. The web app keeps it next to the label (`PlannerStore.setLabel(point, label, short)`, `shortOf`).
3. **The proposal follows the route until the user types.** It is recomputed whenever the places change (the names arrive after the route, a stop is added, the route is reversed). As soon as the user edits the field by hand, the automatic naming stops for this route: nothing the user changes in the route touches their name. Emptying the field keeps it empty on screen and saves the proposal. The automatic naming starts again when the route is cleared (a new route) and after saving.
4. **No clash in the list.** A proposal equal to the name of a saved route gets the date: `Clermont-Ferrand → Issoire, 11 Nov 2026`, then ` (2)`, ` (3)` if even that exists.
5. The name is what the GPX track and the FIT course carry (already the case); the FIT file keeps its own 48-byte limit.

## Done, and how we check it

- API spec: the short name for a search result (a city, a POI, a street), and for a reverse lookup (the locality, not the street).
- Unit tests of the naming rule (every case above, including the fallbacks), of `PlannerStore.setLabel`/`shortOf`, of the saved routes field (proposal, live update, stops after a hand edit, empty field, clash, reset on clear and on save).
- By hand in the browser: click two places, see the proposal arrive; pick a place by search; add a stop; edit the name, change the route, see the name stay; clear, see it come back.
- `en.json` and `fr.json` have every new key; `CLAUDE.md` updated. Lint, build, targeted tests, `npm run generate-client` leaves no diff after its commit.

## Constraints

- No hard-coded string, no new dependency. Names already saved are never renamed.

## Out of scope

- Renaming existing saved routes; naming from the stops' street names; the elevation or the profile in the name; names in two languages (a saved name is a snapshot in the language of the moment).
