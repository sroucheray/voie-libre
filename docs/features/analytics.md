# Brief: measure the traffic without personal data

State: **in progress**. The author approved design (c) on 2026-11-14 with the reduced first scope below.

## Why

The only user so far is the author. Before sharing the link more widely, they want to know whether the app is used, without collecting anything about the people who use it. Today the README and the About window say "no analytics and no advertising", so whatever is chosen must keep that honest or change those words on purpose.

## What the author wants to learn (interview of 2026-11-14)

- Visits per day.
- Unique visitors, **per day only**: how many different people came today, not how many come back from one day to the next.
- Which features are used: routes computed (by profile), loops, GPX and FIT exports, offline areas, GPX imports, saves.
- Where from and on what: language (FR/EN), device class (phone, tablet, desktop), where the visit comes from (direct, search engine, another site).

Not wanted: place names, coordinates, routes, a stable identifier, a cookie.

## Answers recorded

| Question              | Answer                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Who reads the numbers | The author only. No public page. A command line or a private dashboard; an external service is fine if it collects nothing personal.            |
| How long is it kept   | 13 months, aggregated.                                                                                                                          |
| Unique visitors       | Per day only (a daily salted hash that is never stored, or an equivalent).                                                                      |
| Out of scope          | No consent banner; no routes, places or coordinates in the statistics; no heavy new service on the 4 GB VPS; no counting of purely offline use. |

## What exists today

- Caddy has no `log` directive: **no access log at all** is written (`docker/caddy/Caddyfile`). The rate limit of the API reads the visitor address through `TRUST_PROXY` and keeps it in memory only.
- One origin (`voielibre.app`: web app, `/api`, `/tiles`), PostgreSQL + PostGIS already running, two SQL migrations, an Angular service worker that caches the app shell and the basemap fonts and sprites but does not touch `/api`.
- Texts to keep true: `README.md` ("Your routes and your privacy"), `about.privacy` in `apps/web/public/i18n/en.json` and `fr.json` (the key says nothing about analytics, the README does), `docs/implementation.md#about`.

## Options compared

"Consent" below is my reading of the CNIL audience-measurement exemption, not legal advice: it applies when the measure is strictly for audience, data stays with the publisher, no cross-site tracking, anonymous aggregate output, a cookie or identifier no older than 13 months and raw data no older than 25 months, and visitors are told and can object. Check the current CNIL page before shipping.

### (a) Caddy access logs, read with GoAccess

- **Collects**: one line per request with address, user-agent, path, referrer. Needs `log` in the Caddyfile, then the address must be dropped or truncated (Caddy can hash or delete fields with a log filter), plus rotation (`roll_keep_for` of 13 months at most).
- **Consent**: raw IP and user-agent in a file is personal data. Under the exemption only if truncated or removed quickly; "visitors", "device" and "language" then come out noisy. Bots and every tile range request pollute the counts.
- **Features**: invisible. A route computation is one `POST /api/route`: countable, but not the profile, nor an export (done on the device, no request).
- **Service worker and offline**: requests answered by the cache never reach the server, so installed-app visits are undercounted.
- **Effort**: low (a Caddy snippet and a script), nothing in the app. **Cost**: nil.
- **Mismatch risk**: medium. It is a log of everyone's addresses unless filtered perfectly, and the author runs the server by hand.

### (b) Self-hosted cookieless counter (Plausible, Umami, GoatCounter)

- **Collects**: page view, referrer, browser, OS, screen class, country, a daily hash for uniques. Custom events for features (name plus a few properties).
- **Consent**: none needed when configured as the tool documents (no cookie, no cross-site), with the same duty to inform.
- **Weight on the VPS**: Plausible Community Edition wants ClickHouse + PostgreSQL, around 2 GB of RAM: out of scope. Umami is one Node container reusing PostgreSQL (a few hundred MB). GoatCounter is one Go binary with SQLite, tiny.
- **Service worker and offline**: the script is a first-party file, cached; the beacon fails silently offline. Counting is the same as (c).
- **Effort**: medium (container, reverse proxy path, protected dashboard, upgrades, backups), a script tag in the app. **Cost**: nil in money, a little in RAM and in upkeep.
- **Mismatch risk**: low for privacy, but a new third-party codebase serves a script on every page and sees every visitor's address. GoatCounter is the best of the three for this server and gives a phone-friendly dashboard.

### (c) First-party counter in our own API (aggregate only)

- **Collects**: only counters, in one table: `(day, metric, dimension, count)`. Metrics: `visit`, `unique` (daily), and events from a fixed whitelist (`route`, `loop`, `export_gpx`, `export_fit`, `offline_area`, `gpx_import`, `save`). Dimensions are a short fixed list: language, device class (from the window width, not the user-agent), referrer class (direct, search, other), and for `route` the profile. No path, no place, no coordinate, no user-agent, no address stored.
- **Uniques**: the API computes a hash of address + user-agent + a random salt held in memory and replaced every day, only to know whether it already counted that visitor today; the hash is never written to disk and is gone at midnight or on restart (a restart can count a visitor twice: accepted).
- **Consent**: no cookie, no `localStorage`, nothing kept on the device, nothing leaves the origin: inside the exemption as read above. The opt-out is a switch in About ("Do not count my visits"), remembered in `localStorage` as a plain preference, plus honouring the browser's Do Not Track.
- **Service worker and offline**: `/api` is not cached, so the beacon is sent when the app starts online and dropped when offline (no queue). Offline-only use is not counted, as asked.
- **Effort**: medium. A migration, `POST /stats` (TypeBox schema, rate limited, answers 204), a pruning job at 13 months, a tiny `Analytics` service on the web side that fires from existing code paths, tests, texts. A script `scripts/stats.sh` for the author (a `psql` query run on the server). No new container.
- **Cost**: nil. **Mismatch risk**: lowest, since the server was already receiving requests; the texts change from "no analytics" to "visits are counted in aggregate".
- **Weak points**: no dashboard beyond the command line (a private page can come later behind a token); the country is **not** available (it needs a GeoIP database; left out); bots that run the page are counted; the whitelist must be kept in step with the features.

### (d) Hosted privacy-friendly service (Plausible Cloud, Fathom, Simple Analytics, Cloudflare Web Analytics)

- **Collects**: same as (b), on their servers. The visitor's address reaches a company that is not us; most promise to discard it after hashing.
- **Consent**: the vendors' claim of no consent needed depends on their setup and on the country of hosting; one more thing to verify and to name in the privacy text.
- **Service worker and offline**: a third-party script that cannot be precached; offline it is simply missing. The app today calls no external domain except the two optional layers, so this adds a third, on every visit, switched on by default.
- **Effort**: lowest. **Cost**: roughly 9 EUR a month for the small paid plans (check), or free with Cloudflare.
- **Mismatch risk**: highest for "local first, no third party". The author allows it if nothing personal is collected, so it stays a valid fallback if they would rather not maintain code.

### Summary

| Criterion             | (a) Caddy logs     | (b) GoatCounter / Umami | (c) Own counter              | (d) Hosted                    |
| --------------------- | ------------------ | ----------------------- | ---------------------------- | ----------------------------- |
| Personal data touched | Yes, then filtered | Address in transit      | Address in transit, RAM only | Address sent to a third party |
| Consent banner        | Risky              | No                      | No                           | Depends on vendor             |
| Features per profile  | No                 | Yes, with events        | Yes                          | Yes, with events              |
| Country               | No                 | Yes                     | No                           | Yes                           |
| Dashboard             | GoAccess report    | Yes                     | Command line                 | Yes                           |
| New thing to run      | Log files          | A container             | Nothing                      | Nothing                       |
| New external domain   | No                 | No                      | No                           | Yes                           |
| Effort                | Low                | Medium                  | Medium                       | Low                           |

## Recommendation: (c), our own counter in the API

It is the only option that adds nothing to the server, calls no third party, stores no identifier, and answers every wish except the country. It keeps "local first": the server learns that a visit happened, never who made it nor what they planned. If the author wants a phone dashboard and the country more than a code-free server, the fallback is GoatCounter (b).

## What it does to the privacy texts

Changed on purpose, in English and French, when the feature ships:

- `README.md`, "Your routes and your privacy": replace "There are no analytics and no advertising." with "There is no advertising and no tracking. The server counts visits and uses of each feature in aggregate (a number per day, per language and per device type), with no cookie, no identifier and no address kept; you can switch it off in the About window."
- `about.privacy` (`en.json`, `fr.json`): add the same sentence, and a labelled switch "Do not count my visits" in the About window (new keys, no hard-coded string).
- `docs/implementation.md#about` and `CLAUDE.md` (one line, "Statistics"): added with the code.

## What "done" looks like

- A visit to `https://voielibre.app` adds one to `visit` of the day, once per page load that starts online, and to `unique` once per visitor per day.
- Computing a route, an export, a saved route, a GPX import and an offline area each add one to their event, with the profile for a route; nothing else can be sent (the API rejects any other name or value with a stable error code).
- No table or log holds an address, a user-agent, a path, a place or a coordinate; the daily salt is only in memory; rows older than 13 months are deleted.
- The switch in About, and Do Not Track, stop every call.
- `scripts/stats.sh` prints the last days from the server; the privacy texts match what the code does.

How we check: API tests (accepted and rejected events, no write of anything but the counters, pruning), a web test per event and for the switch, a read of the database after a manual session, and the network tab showing a single `POST /api/stats` and nothing to another domain.

## Out of scope

Country or city of the visitor, a public statistics page, a graphical dashboard, counting offline use, funnels and sessions, any identifier that lasts more than a day, a consent banner, a third-party service.

## First scope, decided by the author on 2026-11-14

- Design (c), read **from the command line only**, by a script that runs on the author's machine and reaches the server over SSH (same variables as `scripts/deploy.sh`: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_DIR`). Nothing about the server goes in the repository.
- Counted: visits, uniques of the day, language, device class, and the events `route`, `loop`, `export_gpx`, `export_fit`, `save`.
- About the routes computed, only numbers that cannot point to one route: how many (by profile), the sum of their kilometres (so the mean is a sum divided by a count), a few distance bands (under 20 km, 20 to 50, 50 to 100, 100 to 200, over 200), and the sums of points and of stops (so their means). No single distance or count is stored by itself. No mean climb.
- Postponed: where the visit comes from, `offline_area`, `gpx_import`, any dashboard. Excluded for good: the country.
- The server also ignores a request that carries `DNT: 1` or `Sec-GPC: 1`.

## Plan

One commit per step after lint, build and the targeted tests.

- [x] **1. API.** Migration `stats_daily(day, metric, dimension, count, total)`; `POST /stats` with a whitelist schema, daily in-memory salt for the uniques, rate limit; pruning at 13 months. Targeted tests in `apps/api`.
- [x] **2. Web.** `Analytics` service (visit at start, events from the existing code paths, a switch and Do Not Track), regenerate the client with `npm run generate-client`. Targeted tests.
- [x] **3. Texts.** README, `about.privacy`, the About switch, `docs/implementation.md`, `CLAUDE.md`, French and English keys.
- [x] **4. Reading the numbers.** `scripts/stats.sh`, run from the author's machine over SSH.

### Notes

- Built on 2026-11-14. Not deployed yet: it goes out with the next `v*` tag, and the `migrate` service creates `stats_daily` then. Afterwards `DEPLOY_HOST=user@host scripts/stats.sh [days]` prints the numbers from the author's machine (read only: the session sets `default_transaction_read_only`).
- Nothing is counted in development (`ANALYTICS_ENABLED` is `!isDevMode()`), so the author's own tests stay out of the numbers; the author's visits in production count unless they tick "Do not count my visits" in About.
- Checked: API tests of `POST /stats`, the web service, the About switch, the route planner and the translations spec; the SQL of `stats.sh` against the local database. Not run: the whole suites, and the script over SSH.
