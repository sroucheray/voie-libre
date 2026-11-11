# Map layers: proposals

Asked on 2026-11-10 (see `BRIEF-reverse-fit-snap.md`). Nothing here is built. This document lists what the map could show beyond today's single basemap, what each layer needs, and an order to build them in.

Decision already taken: the default basemap stays local. Optional layers may call a public server when the user turns them on, and the switcher says so.

Effort: **S** up to a day, **M** two or three days, **L** about a week. Sizes marked "measured" were computed from the files in `data/`; the others are estimates to confirm when building.

## Summary

| #   | Proposal                          | What the user sees                                                         | Data                                  | Calls an external server | Effort    |
| --- | --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------- | ------------------------ | --------- |
| 1   | Layer switcher                    | A button on the map: one base (Map, Imagery), overlays to tick             | none                                  | no                       | S         |
| 2   | Hillshade                         | Relief shading under the roads                                             | Copernicus GLO-30, already downloaded | no                       | M         |
| 3   | Ways for the profile              | Roads, tracks or paths stand out depending on the profile                  | current tiles                         | no                       | S         |
| 4   | Surface and way type of the route | A bar under the profile: paved, track, path; the same colours on the route | BRouter's answer                      | no                       | M         |
| 5   | Imagery (France)                  | IGN aerial photos as a base                                                | IGN Géoplateforme                     | yes, opt-in              | S         |
| 6   | Contour lines                     | Lines every 10 or 20 m at close zooms                                      | same tiles as 2                       | no                       | M         |
| 7   | Own way tiles                     | Surface, track grade, trail difficulty, signed routes on the map           | OpenStreetMap extract, built by us    | no                       | L         |
| 8   | Slope shading                     | Steep ground coloured by grade                                             | tiles derived from 2                  | no                       | M         |
| 9   | 3D terrain                        | The map tilts over real relief                                             | same tiles as 2                       | no                       | S after 2 |
| 10  | Imagery (world)                   | Satellite base outside France                                              | Sentinel-2 cloudless                  | yes, or 1 GB+ to host    | M         |

## 1. Layer switcher (done 2026-11-10, with the relief as its only entry)

A map control like the zoom buttons: an Angular element, translated, usable by keyboard and touch.

- **Base** (one at a time): Map, Imagery.
- **Overlays** (any number): Relief, Contours, Ways for the profile, Signed routes.
- The choice is kept on the device (`localStorage`); it is a display preference, never sent.
- A layer that calls an external server carries a note under its name ("Loads images from data.geopf.fr"), is off by default, and is disabled offline (`NetworkStatus`).
- The attribution element lists the sources of the layers on screen.

In the code: `buildBasemapStyle` takes the set of layers; overlays are added and removed with `addLayer`/`removeLayer` rather than a full `setStyle`, so the planner's own layers stay in place.

## 2. Hillshade (done 2026-11-10)

Built as described in `BRIEF-relief.md`: `npm run build-relief` writes `data/basemap/relief.pmtiles`, **19.6 MB measured** for the test region (100 PNG tiles, zooms 6 to 11, elevations rounded to 0.25 m), more than the first estimate below, which assumed WebP and whole metres. The notes below are the proposal as it was written.

MapLibre draws shading itself from elevation tiles (`raster-dem` source, `hillshade` layer). The elevations come from the Copernicus GLO-30 files that `scripts/download-relief.sh` already fetches for the API.

- **Build step** (new script): reproject the GeoTIFFs to Web Mercator, cut them in 512 px tiles, encode each elevation in the red, green and blue channels (the "terrarium" encoding MapLibre reads), store them in one PMTiles archive in `data/basemap`, served by the existing `tiles` service.
- **Size, measured** on `N45 E003` (one 1° × 1° cell, native resolution): 18 MB with centimetre precision, **4.8 MB with whole metres** (lossless WebP). Whole metres are enough for shading. With the lower zooms, about 6.5 MB per cell: about 13 MB for the two cells of the test region, and in the order of 0.6 GB for France (mountain cells weigh more).
- **Offline**: the archive is read by byte ranges like the basemap; `OfflineBasemap` downloads a second file.
- **Licence**: Copernicus, credit required (already shown for the elevation profile).
- **Risks**: GLO-30 is a surface model (it includes forests and buildings), so shading is slightly noisy in towns; 30 m is coarse above zoom 13 (shading gets soft, not wrong).

## 3. Ways for the profile (from the current tiles; done 2026-11-11)

The basemap's road layer carries a class and the OpenStreetMap highway value for each way (`kind`, `kind_detail`: checked in the local archive). That is enough to restyle the map per profile, with no new data:

- **Road**: tertiary and minor roads and cycleways stand out; motorways and trunk roads are greyed; tracks and paths fade.
- **Gravel**: tracks and paths stand out beside the minor roads.
- **Trail**: paths, footways and tracks stand out; roads fade.

The same classes already decide where a point may snap (`snap-to-way.ts`), so the map would show exactly the ways a click can land on.

- **Limit**: the tiles have no surface, no track grade, no cycling or hiking route, no traffic. A paved track and a muddy one look the same. Proposal 7 lifts this.
- **Limit**: small roads and paths enter the tiles from zoom 12 and are all there at zoom 14 only; below, only main roads can be styled.

## 4. Surface and way type of the computed route (done 2026-11-11)

BRouter can return, for each stretch of a route, the OpenStreetMap tags it travelled on (`highway`, `surface`, `tracktype`...; the `WayTags` column of its messages, used in `spike/brouter`). The API does not read them today.

- `RoutingProvider` returns stretches with a way type and a surface (a small fixed list: paved road, cycleway, unpaved road, track, path, unknown); `POST /route` carries them; the saved route stores them.
- Under the elevation profile: a bar with the share of each type ("82 % paved, 14 % track, 4 % path"), and the chart or the route line coloured the same way.
- Answers the question "is this route what my bike can take?" better than any map layer, for the route at hand.
- **Risks**: the response schema and the stored route change (a `schemaVersion` step); local edits must splice the stretches like they splice the geometry; imported GPX files have none.

## 5. Imagery for France (opt-in; done 2026-11-11)

IGN publishes its aerial photos (20 cm on most of France) as tiles on the Géoplateforme (`data.geopf.fr`, WMTS layer `ORTHOIMAGERY.ORTHOPHOTOS`), without a key, under the Licence Ouverte Etalab 2.0 (credit IGN).

- A raster source and one layer under the labels and the roads, so names and the route stay readable. A "hybrid" look comes for free: keep the basemap's road and label layers on top.
- The browser calls `data.geopf.fr` directly: the server sees the user's address and the area looked at. Hence opt-in, with the note in the switcher. Nothing about the route is sent.
- Not available offline; not kept by the service worker (size, and the terms of use to check before caching).
- To check when building: the current usage limits of the Géoplateforme and the exact tile URL.
- Covers France only: outside, the layer is empty (see 10).

## 6. Contour lines

Two ways from the tiles of proposal 2:

- **In the browser** with `maplibre-contour` (BSD licence): it computes the lines from the elevation tiles on the fly, with labels, at an interval that follows the zoom. No extra data, works offline; a new runtime dependency (about 30 KB) and some work on the device at each tile.
- **Pre-built** vector tiles (`gdal_contour` then a tile builder): no computation on the device, but another archive (in the order of the hillshade's size) and a longer build.

The first one is the better start. With 30 m data, lines closer than 10 m apart are not meaningful.

## 7. Own way tiles

To show what the Protomaps tiles do not carry, build a second vector archive from an OpenStreetMap extract (Geofabrik: Auvergne for the test region, France later) with Planetiler (Apache 2.0, Java, a custom schema) or tilemaker (Lua).

One overlay layer of ways with only the attributes we use:

- `surface`, `tracktype`, `smoothness`: paved or not, and how rough: the real answer for Road and Gravel;
- `sac_scale`, `trail_visibility`: trail difficulty, for Trail;
- `bicycle`, `foot`, `access`: where one may not go;
- `maxspeed`, `lanes`: a stand-in for traffic (there is no open traffic count);
- membership of signed routes (cycling networks `icn`/`ncn`/`rcn`/`lcn`, hiking routes such as the GR): an overlay of signed routes, in their network colours.

Consequences:

- A build to run and re-run (data ages), a second archive to serve and to download for offline use. Size to measure; expect a few MB for the test region and some hundreds of MB for France.
- The snapping rule could read `surface` from it and stop putting a road bike on an unpaved "minor road".
- The basemap extract (`BASEMAP_BBOX`) and this archive must cover the same area.
- ODbL credit, as for the basemap.

A lighter alternative for signed routes only: the Waymarked Trails raster overlay, as an opt-in external layer (their tiles are meant for light use; check their terms). It shows routes but cannot be styled or queried.

## 8. Slope shading

Colours by grade (for example yellow above 10 %, red above 20 %): useful to runners and to anyone reading a climb.

MapLibre has no slope layer. Either pre-compute raster tiles (`gdaldem slope`, then a colour ramp, then tiles: one more archive, about the size of the hillshade one), or compute them in the browser from the elevation tiles through a custom protocol. The elevation profile already shows the grade of the route itself, so this comes late.

## 9. 3D terrain

`map.setTerrain` on the same elevation source as the hillshade: the map tilts and the relief stands up. Cheap once proposal 2 exists.

- Markers, the ghost and dragging the route work on a tilted map only if clicks are projected on the terrain: to test with the planner before offering it.
- Mostly pleasant for looking at a finished route. Planning is easier flat.

## 10. Imagery outside France

- **Sentinel-2 cloudless** (EOX): the 2016 mosaic is CC BY 4.0; later years are non-commercial. About 10 m per pixel: fields and forests, not paths. EOX's public server is meant for light use.
- **Hosting it ourselves**: about 15 MB for the test region and more than 1 GB for France (estimates, JPEG tiles down to zoom 13), plus a long download to prepare it.
- Commercial imagery (Esri, Google, Mapbox) is not open and its terms do not fit this project.

Worth doing only when the app is used outside France.

## Not possible with open data

- **Popularity heatmaps** ("where people ride"): Strava's and Komoot's are theirs. Without accounts and collected traces, Voie Libre has no such data, and collecting it is against the project's local-first rule.
- **Real traffic**: no open counts at the scale of a country. Road class, speed limit and lane count (proposal 7) are the usable stand-in.

## Recommended order

1. **Switcher and hillshade** (1, 2): done. The data is already on disk, it works offline, and relief is what the plain map lacks most for cycling and running.
2. **Ways for the profile** (3): done (a checkbox in the switcher, three levels per profile, see `BRIEF-ways.md`).
3. **Surface and way type of the route** (4): done (five categories from BRouter's way tags, a bar under the profile, an option to colour the route on the map; see `BRIEF-surface.md`).
4. **IGN imagery, opt-in** (5): done (a checkbox with a note about the server it calls, photos under the roads and names, off when offline; see `BRIEF-imagery.md`).
5. **Contours** (6), then **own way tiles** (7) when surfaces and signed routes on the map are worth a build pipeline.
6. **Slope, 3D, world imagery** (8, 9, 10) last.
