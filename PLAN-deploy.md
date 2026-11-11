# Plan: put Voie Libre online

See [BRIEF-deploy.md](BRIEF-deploy.md). One commit per step in the repository, after lint, build and the targeted tests. Steps marked **server** are commands the author runs on the VPS (one at a time, output pasted back); Claude never connects to it.

- [x] **0. Server base** (server): updates, `ufw` on 22/80/443, Docker + Compose, 2 GB swap.
- [x] **1. Addresses of the API and the tiles.** `API_BASE_URL` and the tiles base URL default to `${location.origin}/api` and `${location.origin}/tiles` in the production build, `http://localhost:3000` and `http://localhost:8081` in development (`isDevMode()` or a file replacement; tests keep their fakes). Test: the token factories in both modes.
- [ ] **2. Production compose and Caddy.** `docker-compose.prod.yml` (db, brouter, tiles, api, caddy; only caddy publishes 80 and 443; `restart: unless-stopped`; memory limits), `docker/caddy/Caddyfile` (`voielibre.app`: `/api/*` and `/tiles/*` proxied with the prefix stripped, the rest from the web build with an `index.html` fallback, gzip, `Cache-Control` rules that keep `index.html` and `ngsw.json` revalidated), `docker/web/Dockerfile` (Caddy + `dist/apps/web/browser`), `.env.production.example`. Check: `docker compose -f docker-compose.prod.yml config` and a local run on another port.
- [ ] **3. Database migrations in production.** A way to run them from the API image (the `migrate.ts` script needs the whole repository): a one-shot `migrate` service or the API running them at start. Check on a fresh local database.
- [ ] **4. Build and send.** `scripts/deploy.sh`: build the web app and the images locally, `docker save | ssh docker load`, copy the compose file, Caddyfile and `.env` template, `docker compose up -d`. No secret in the script.
- [ ] **5. Data on the server** (server): the six BRouter segments, then the basemap (`download-basemap.sh`, or `rsync` if it fails), checked by size and a `HEAD` through Caddy.
- [ ] **6. DNS and first start** (author, server): `A` (and `AAAA` if any) record of `voielibre.app` to the server, `.env` with a generated database password, migrations, `up -d`, Caddy obtains the certificate.
- [ ] **7. Hardening and backups** (server): SSH password login off, `fail2ban`, `unattended-upgrades`; nightly `pg_dump` with rotation, a copy to the laptop (or an Infomaniak snapshot).
- [ ] **8. Smoke test.** Angers → Lyon, Bordeaux → Marseille, a search, a saved route reopened, "Download the map" on a small area, the position button on the phone, `ss -tlnp` and an outside port scan, reboot test.
- [ ] **9. `docs/deployment.md`, `CLAUDE.md` and `README.md`**: the steps from zero, the production layout, what is not done.
