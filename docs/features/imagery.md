# Voie Libre — Brief: aerial photos from the IGN, as an option

Follow-up to [ways.md](ways.md) and proposal 5 of [docs/map-layers.md](../map-layers.md). Asked on 2026-11-11.

## Problem

The map is a drawing. To judge a track, a path or the ground around a route, an aerial photo says more. IGN publishes its photos for all of France, free, on the Géoplateforme.

## Who and where

The author, on desktop and on touch. Nothing may depend on hover.

## Decision already taken

The default basemap stays local and the map calls no external domain. This layer is the first opt-in exception: it is off by default, ticking it is the consent, and the switcher says what it does.

## Scope

1. **A layer "Aerial photos (IGN, France)"** in the switcher, off by default, the choice kept on the device (`MapLayers`, same key, never sent).
2. **Hybrid look.** The photos replace the basemap's land, water and building fills; the roads, paths and names stay drawn over them. The relief, when on, is drawn over the photos. "Ways for the profile" works over them too.
3. **Source.** IGN Géoplateforme WMTS, layer `ORTHOIMAGERY.ORTHOPHOTOS`, matrix set `PM` (Web Mercator, zooms 6 to 19), 256 px JPEG, no key: `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}` (checked on 2026-11-11: answers 200 with `access-control-allow-origin: *`). The only external host the map can call, named in one constant.
4. **What the user is told.** A permanent note under the checkbox: the layer calls the IGN server, which sees the user's address and the area looked at; nothing about the route is sent. No confirmation dialog.
5. **Offline.** Not available: the checkbox is disabled with a note while the device is offline, and an offline moment falls back to the local map by itself. Not kept by the service worker and not part of "Download the map".
6. **Credit.** "Photos: IGN" in the attribution while the photos are shown (Licence Ouverte Etalab 2.0).
7. Outside France the photos are empty: the note says France.

## Done, and how we check it

- Unit tests: style (no external URL unless asked; the only one is the IGN's; fills replaced; roads and labels kept; relief over the photos), `MapLayers` (default off, stored), `MapView` (checkbox, note, attribution, offline disabled and fallback).
- By hand in the browser: photos at zoom 12 to 17 around Clermont-Ferrand with roads and names over them, the switcher, the network request going to `data.geopf.fr` only when ticked.
- `en.json` and `fr.json` have every new key; `CLAUDE.md` (the "never calls an external domain" rule now has this exception), `docs/map-layers.md` updated. Lint, build and targeted tests pass.

## Constraints

- No new dependency, no secret, no key. Rules of `CLAUDE.md`.

## Out of scope

- Photos outside France (proposal 10); caching or downloading the photos; choosing the year or an infrared layer; IGN's own road overlay.
- The Géoplateforme's usage terms are those of an open public service: reasonable use, credit IGN. A heavier use would need a look at them again.

## How it went

Built in 3 steps, one commit each: Style; Switcher; Keys, tests, docs.

### Checked

In the browser on the local stack: at zoom 15 around Clermont-Ferrand the photos replace the land with the roads, the ways of the profile and the names over them, "Photos: IGN" in the credit; the only external host the page contacted was `data.geopf.fr`, and none at all with the box unticked (by default). Specs for the style, `MapLayers` and `MapView` (including offline).

Not checked: touch; the network really cut with the photos on (the spec fakes it); outside France (the photos are empty there); the Géoplateforme's usage limits for heavier use.
