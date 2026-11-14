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

How we check: the smoke test of `deploy.md#plan` step 8, run from the phone and the laptop, plus `ss -tlnp` and a port scan from outside.

## What exists

- Server: Infomaniak VPS Lite, 2 vCPU, 4 GB RAM, 58 GB disk, Ubuntu 26.04 LTS, annual plan. Done on it so far: updates, `ufw` (22, 80, 443), Docker 29 with Compose 2.40, 2 GB swap. SSH by key as `ubuntu`.
- Domain: `voielibre.app`, bought at Infomaniak (author's action).
- Repository: a development `docker-compose.yml` (db, brouter, tiles, api under the `full` profile), an API `Dockerfile`, `docker/tiles/default.conf`, download scripts for segments and basemap, `scripts/migrate.ts`.
- Gap found: the web app has `http://localhost:3000` (API) and `http://localhost:8081` (tiles) as defaults in `core/api/api-client.ts` and `core/map/map-factory.ts`. The production build needs other addresses.

## Decisions

- **One origin.** Caddy serves the web app and proxies `/api/*` to the API (prefix stripped) and `/tiles/*` to the tiles server, so no CORS and a single certificate. The `/p/:id` page of the web app is why the API cannot sit at the root.
- **HTTPS by Caddy** (automatic Let's Encrypt), the only service publishing ports.
- **Deployed by GitHub Actions on a version tag** (`v*`, after the CI checks): `.github/workflows/deploy.yml` builds the four images, publishes them to `ghcr.io/<owner>/voie-libre/*` and has the server pull them over SSH (a dedicated key in repository secrets, the server's host key pinned; the job's own token lets the server pull even private images). A manual run with an existing tag goes back to an earlier version. Never from a pull request. The repository will become public, so no address, key or password may be in it. `scripts/deploy.sh` (images built on the author's machine and sent over SSH) stays as a fallback.
- **Routing area: metropolitan France**, seven BRouter segments: `W5_N40`, `W5_N45`, `E0_N40`, `E0_N45`, `E0_N50`, `E5_N40`, `E5_N45` (about 850 MB; names checked before downloading). The first six were not enough: France goes above 50° N (Lille, Calais, Dunkirk), so `E0_N50` was missing, found on 2026-11-14 when a route in the north answered `datafile E0_N50.rd5 not found`. `scripts/download-segments.sh france` fetches the seven.
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

## Plan

See [deploy.md](deploy.md). One commit per step in the repository, after lint, build and the targeted tests. Steps marked **server** are commands the author runs on the VPS (one at a time, output pasted back); Claude never connects to it.

- [x] **0. Server base** (server): updates, `ufw` on 22/80/443, Docker + Compose, 2 GB swap.
- [x] **1. Addresses of the API and the tiles.** `API_BASE_URL` and the tiles base URL default to `${location.origin}/api` and `${location.origin}/tiles` in the production build, `http://localhost:3000` and `http://localhost:8081` in development (`isDevMode()` or a file replacement; tests keep their fakes). Test: the token factories in both modes.
- [x] **2. Production compose and Caddy.** The API gets `TRUST_PROXY` (rate limits count each visitor behind Caddy). `docker-compose.prod.yml` (db, brouter, tiles, api, caddy; only caddy publishes 80 and 443; `restart: unless-stopped`; memory limits), `docker/caddy/Caddyfile` (`voielibre.app`: `/api/*` and `/tiles/*` proxied with the prefix stripped, the rest from the web build with an `index.html` fallback, gzip, `Cache-Control` rules that keep `index.html` and `ngsw.json` revalidated), `docker/web/Dockerfile` (Caddy + `dist/apps/web/browser`), `.env.production.example`. Check: `docker compose -f docker-compose.prod.yml config` and a local run on another port.
- [x] **3. Database migrations in production.** A way to run them from the API image (the `migrate.ts` script needs the whole repository): a one-shot `migrate` service or the API running them at start. Check on a fresh local database.
- [x] **4. Build and send.** `scripts/deploy.sh` (fallback): build the images locally, `docker save | ssh docker load`, copy the stack files, `up -d --no-build`.
- [x] **4b. GitHub Actions deployment.** `.github/workflows/deploy.yml`: on a `v*` tag (CI checks first, `ci.yml` is reusable) or by hand with an existing tag (rollback): build and push `web`, `api`, `migrate`, `brouter` to `ghcr.io`, send the stack files, `docker compose pull && up -d` on the server, health check on `SITE_URL/api/health`. The image names follow `IMAGE_PREFIX` and `VERSION` in `docker-compose.prod.yml`.
- [x] **4c. GitHub setup** (author): a dedicated SSH key whose public half is on the server; repository secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` and variable `SITE_URL`.
- [x] **5. Data on the server** (server): the BRouter segments (seven, see above), then the basemap (`download-basemap.sh`, or `rsync` if it fails), checked by size and a `HEAD` through Caddy.
- [x] **6. DNS and first start** (author, server): `A` (and `AAAA` if any) record of `voielibre.app` to the server, `.env` with a generated database password, migrations, `up -d`, Caddy obtains the certificate.
- [ ] **7. Hardening and backups** (server): SSH password login off, `fail2ban`, `unattended-upgrades`; nightly `pg_dump` with rotation, a copy to the laptop (or an Infomaniak snapshot).
- [ ] **8. Smoke test.** Done from outside on 2026-11-11: HTTPS certificate, health, Angers to Lyon (26 s), Bordeaux to Marseille (74 s), a trail, a search, tiles by range. Left: the phone, a saved route reopened, "Download the map", the reboot test, an outside port scan. Original list: Angers → Lyon, Bordeaux → Marseille, a search, a saved route reopened, "Download the map" on a small area, the position button on the phone, `ss -tlnp` and an outside port scan, reboot test.
- [ ] **9. `docs/deployment.md`, `CLAUDE.md` and `README.md`**: the steps from zero, the production layout, what is not done.

### Notes from the first deployment

- Infomaniak's own firewall (Manager, VPS, Firewall) had to open ports 80 and 443 before Let's Encrypt could reach Caddy; `ufw` alone is not enough.
- The upstream BRouter Dockerfile needs buildx, so `docker/brouter/Dockerfile` follows it without BuildKit-only features.
- Node's `fetch` crashed the API on a large BRouter answer (`assert(!this.paused)` in undici): BRouter is now read with `node:http` (`routing/http-get.ts`).
- GitHub Actions left the first run of CI `queued` for hours, so `deploy.yml` has not run yet; the first version went out with `scripts/deploy.sh`.
