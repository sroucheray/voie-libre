# Brief: put Voie Libre online

## Who it is for

The author alone at first, on a phone and a laptop, then people they share the link with. Nothing is stored about visitors: routes stay on the device, the server only computes routes and searches places.

## What "done" looks like

- `https://voielibre.app` opens the planner over HTTPS, on a phone too (the browser gives the position only to a secure page).
- A route from Angers to Lyon, one from Bordeaux to Marseille, and a place search all work.
- The map shows France, the hillshade comes from the public terrain tiles, "Download the map" keeps an area offline.
- Only ports 22, 80 and 443 answer from outside; PostgreSQL, BRouter and the API are never exposed.
- A reboot of the server brings everything back by itself; a nightly database dump exists on another machine.
- The steps to rebuild the server from zero are written down (`docs/deployment.md`).

How we check: the smoke test of `PLAN-deploy.md` step 8, run from the phone and the laptop, plus `ss -tlnp` and a port scan from outside.

## What exists

- Server: Infomaniak VPS Lite, 2 vCPU, 4 GB RAM, 58 GB disk, Ubuntu 26.04 LTS, annual plan. Done on it so far: updates, `ufw` (22, 80, 443), Docker 29 with Compose 2.40, 2 GB swap. SSH by key as `ubuntu`.
- Domain: `voielibre.app`, bought at Infomaniak (author's action).
- Repository: a development `docker-compose.yml` (db, brouter, tiles, api under the `full` profile), an API `Dockerfile`, `docker/tiles/default.conf`, download scripts for segments and basemap, `scripts/migrate.ts`.
- Gap found: the web app has `http://localhost:3000` (API) and `http://localhost:8081` (tiles) as defaults in `core/api/api-client.ts` and `core/map/map-factory.ts`. The production build needs other addresses.

## Decisions

- **One origin.** Caddy serves the web app and proxies `/api/*` to the API (prefix stripped) and `/tiles/*` to the tiles server, so no CORS and a single certificate. The `/p/:id` page of the web app is why the API cannot sit at the root.
- **HTTPS by Caddy** (automatic Let's Encrypt), the only service publishing ports.
- **Deployed by GitHub Actions on a version tag** (`v*`, after the CI checks): `.github/workflows/deploy.yml` builds the four images, publishes them to `ghcr.io/<owner>/voie-libre/*` and has the server pull them over SSH (a dedicated key in repository secrets, the server's host key pinned; the job's own token lets the server pull even private images). A manual run with an existing tag goes back to an earlier version. Never from a pull request. The repository will become public, so no address, key or password may be in it. `scripts/deploy.sh` (images built on the author's machine and sent over SSH) stays as a fallback.
- **Routing area: metropolitan France**, six BRouter segments: `W5_N40`, `W5_N45`, `E0_N40`, `E0_N45`, `E5_N40`, `E5_N45` (about 750 MB; names checked before downloading).
- **Basemap: France**, `basemap.pmtiles` (4.7 GB) with fonts and sprites, built on the server by `scripts/download-basemap.sh` (fallback: `rsync` from the laptop).
- **Relief: public terrain tiles** (default). The local `relief.pmtiles` is not uploaded.
- **Sharing stays hidden** (`SHARING_ENABLED` false); the API route stays there.
- **Place search** keeps the public Photon server (`GEOCODER_URL`).
- Secrets (database password) are generated on the server in a `.env` that is never committed.

## Out of scope

Europe-wide data, a CI/CD pipeline, a registry, monitoring beyond a health check, a second server, accounts, the Android app, own Photon instance.

## Risks

- 4 GB of RAM for PostgreSQL, BRouter (512 MB cap), the API and Caddy: the swap helps; watch `free -h` after the first real use.
- The disk is 58 GB: basemap 4.7 GB, segments 0.75 GB, database and images a few GB; dumps must be rotated.
- Docker publishes ports around `ufw`: only Caddy publishes any.
- `voielibre.app` is on the HSTS preload list: HTTPS only, no fallback to HTTP once the certificate is wrong.
