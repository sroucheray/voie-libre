# BRouter spike — report

Date: 2026-11-07. BRouter 1.7.11-beta (master at `fed8f18`), image built locally from the README, Docker 29.9.3.
Test area: Clermont-Ferrand (France). The whole area fits in one segment, `E0_N45.rd5` (lon 0–5°, lat 45–50°, 122 MiB on disk).

Scope: nothing but BRouter. No UI, no database.

## Short answers

| Question | Answer |
| --- | --- |
| Do polygons work? | **Yes.** `polygons=` and `polylines=` are accepted and the route goes around the zone (checked geometrically). A circle (`nogos=`) works too. A polygon far from the route leaves the route unchanged (control). |
| Are alternatives usable? | **Yes.** `alternativeidx=1..3` return genuinely different routes (3.6 %, 0.6 % and 13.3 % of their points lie within 30 m of alternative 0). Alternative 3 is 10 km longer. Response time grows with the index (0.4 s for 0, 2.0 s for 3). |
| How much memory for the tested area? | A **128 MiB Java heap is enough** for the 41 km, 148 km and 259 km routes (even 64 MiB handled 148 km). The container showed **about 160–220 MiB** with `-Xmx64M..128M`, **~305 MiB** with 256M and **~405 MiB** with 512M. Plan for **512 MiB per container** for one 5°x5° tile; the figure will grow with more tiles and `MAXTHREADS`. |
| Which profiles exist? | In the image: `trekking`, `fastbike`, `fastbike-verylowtraffic`, `gravel`, `mtb`, `shortest`, `softaccess`, `hiking-mountain`, `river`, `skating`, `rail`, `moped`, `car-vario`, `car-vario-nocost`, `all`, `vm-forum-liegerad-schnell`, `vm-forum-velomobil-schnell`, `dummy`. For Voie Libre: road = `fastbike` (or `fastbike-verylowtraffic`), gravel = `gravel`, trail = `trekking`, `hiking-mountain` or `mtb` (to be compared in the app phase). |

## Commands to rerun everything

From `spike/brouter/` (segments, sources and results are git-ignored):

```bash
git clone --depth 1 https://github.com/abrensch/brouter.git brouter-src
(cd brouter-src && docker build -t brouter .)
mkdir -p segments4 results
curl -o segments4/E0_N45.rd5 https://brouter.de/brouter/segments4/E0_N45.rd5   # 128 MB
./start.sh 256M                 # starts the container on :17777, waits until it answers
node run-tests.mjs              # cases a–f, writes results/*.geojson|gpx and results/summary.json
./mem-test.sh 64M 128M 256M     # cold start per heap size, times a 148 km route, samples docker stats
LONLATS='3.087,45.777|3.426,46.128|4.069,46.034|3.548,45.856|3.087,45.777' ./mem-test.sh 128M 512M   # 259 km
docker rm -f brouter            # stop
```

Request shape used: `GET /brouter?lonlats=lon,lat|lon,lat&profile=<p>&alternativeidx=<0..3>&format=geojson|gpx`, plus `&nogos=lon,lat,radius`, `&polylines=lon,lat,lon,lat,...` or `&polygons=lon,lat,lon,lat,...` (the parameter formats were read from `RoutingParamCollector.java`; an optional trailing weight turns a hard avoid into a penalty).

## Results

Trip a/b/c: Clermont-Ferrand → Issoire (trekking unless stated). Times are server round trips on a warm machine.

| Case | Request | Distance | Ascent | Time (est.) | Response | Surface (paved / unpaved / road, no tag / path, no tag) |
| --- | --- | --- | --- | --- | --- | --- |
| a | `trekking` | 41.0 km | 399 m | 2 h 25 | 0.5 s | 86 / 3 / 11 / 0 % |
| a | `fastbike` | 39.1 km | 348 m | 2 h 12 | 0.4 s | 75 / 0 / 25 / 0 % |
| a | `fastbike-verylowtraffic` | 42.3 km | 290 m | 2 h 16 | 0.4 s | 71 / 0 / 30 / 0 % |
| b | alternative 0 | 41.0 km | 399 m | 2 h 25 | 0.4 s | 86 / 3 / 11 / 0 % |
| b | alternative 1 | 40.5 km | 372 m | 2 h 21 | 0.9 s | 73 / 1 / 22 / 4 % |
| b | alternative 2 | 39.6 km | 402 m | 2 h 18 | 1.4 s | 63 / 0 / 35 / 1 % |
| b | alternative 3 | 50.6 km | 345 m | 2 h 44 | 2.0 s | 63 / 12 / 23 / 3 % |
| c | circle, 200 m, mid-route | 42.0 km | 409 m | 2 h 27 | 0.4 s | avoided: yes |
| c | polyline across mid-route | 39.4 km | 364 m | 2 h 18 | 0.5 s | avoided: yes |
| c | polygon (0.006° square, about 460 x 670 m) on mid-route | 39.4 km | 364 m | 2 h 18 | 0.5 s | avoided: yes |
| c | control: polygon far away | unchanged | | | | route identical to original |
| d | via Billom (3 points) | 53.7 km | 422 m | 2 h 58 | 0.3 s | route passes within 1 m of the via point |
| e | GPX, same 3 points | 53.7 km | 422 m | | 0.3 s | see below |
| f | Clermont → Vichy → Roanne | 147.8 km | 647 m | 7 h 33 | ~1 s | 62 / 7 / 30 / 1 % |
| f | loop via Thiers (extreme) | 258.8 km | 1942 m | 14 h 38 | ~1.9 s | 53 / 4 / 40 / 3 % |

Notes on the table:

- Profile comparison (a): `trekking` goes for the most paved share and the most climbing; `fastbike-verylowtraffic` trades 1.3 km and 100 m less climbing for quieter roads; `fastbike` is the shortest. Surface shares are estimated from the `surface`/`highway` tags in the response's `messages`; "road, no tag" is mostly paved but not certain.
- Polyline and polygon gave exactly the same route here. That is expected: the polyline is the diagonal of the square, both block the same crossing, and the route cannot use the cheaper road through it in either case.
- Time is BRouter's estimate for the profile's default rider, not a reliable duration.

### Case e: GPX

- `format=gpx` produces GPX 1.1 (`creator="BRouter-1.7.11-beta"`), one `<trk>`/`<trkseg>`, **1631 `<trkpt>` with 1631 `<ele>`**: every point has an elevation. The file is well-formed XML (parsed with Python's `xml.dom.minidom`). A comment line carries track length, filtered ascent and time.
- Opened in gpx.studio in a real browser: the track is drawn along the expected roads from Clermont-Ferrand to Issoire via Billom, with an elevation profile (about 403 m up, 416 m down). Caveat: the page could not fetch from `localhost` (browser local-network protection), so I loaded a **reduced copy of the same file** (110 of the 1631 points, same structure, built from the real response) by injecting it into the page. gpx.studio therefore showed 50.4 km instead of 53.7 km. The full 108 KB file was not loaded in a viewer. Re-do the check by dragging `results/e_gpx.gpx` onto gpx.studio.

### Case f: time and memory

| Heap (`-Xmx`) | Route | Cold-start container, response | Peak container memory (`docker stats`) |
| --- | --- | --- | --- |
| 64M | 148 km | 200 OK, ~1.8 s | ~171 MiB |
| 128M | 148 km | 200 OK, ~2 s | ~161 MiB |
| 256M | 148 km | 200 OK, ~2 s | ~176 MiB (`mem-test.sh`), ~305 MiB (`run-tests.mjs`) |
| 128M | 259 km | 200 OK, ~3 s | ~217 MiB |
| 512M | 259 km | 200 OK, ~3 s | ~405 MiB |

Memory readings are one-second samples, so they are approximate and not strictly monotonic with the heap size. Peak memory follows the configured heap (the JVM grows into it) more than the route length.

## Limits and caveats

- **Page cache:** all runs were warm for the operating system file cache (the segment had already been read). A first request on a fresh machine reads the 128 MB segment from disk and will be slower; I did not measure that (it needs root to drop the cache).
- **Mistake in my first run:** my first pass reported 52–90 s for the long routes. That was an artefact of my own script (a blocking `execSync` call to `docker stats` stalled Node's event loop and inflated the timing). Fixed (asynchronous sampling); the numbers above are from the fixed script and were confirmed by `mem-test.sh`, which uses curl.
- **Single tile:** only `E0_N45` was loaded. Trips that cross into another tile (for example south of 45°N, towards Le Puy-en-Velay or Aurillac) need `E0_N40` or `E5_N45`. What BRouter does when a tile is missing was not tested. The architecture assumption "the whole of France needs several tiles" is confirmed; Grenoble/Alps would need `E5_N45`.
- **Request limit and threads:** the container ran with `MAXTHREADS=2`. I did not test concurrent requests; memory per extra thread was not measured.
- **Timeout:** default `maxRunningTime=300` s; no route came close.
- **Avoid zones are per request:** nothing is stored by BRouter, the caller must send them every time (fits the "local avoid zones sent with each request" design).
- **Nogo semantics:** a waypoint inside a nogo area disables that nogo (from the BRouter revision notes); the app should warn when start or end falls inside a zone. Not tested.
- **GPX viewer check:** done on a reduced copy (see case e).
- **Public server:** not used. Everything ran against the local container.
- **Profiles:** `gravel`, `mtb`, `hiking-mountain` and `softaccess` exist in the image but were not run in this spike (the brief only asked for trekking and the two fastbike profiles).
