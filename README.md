# Voie Libre

Open-source route planner for road/gravel cycling and trail running, as a website and an Android app.
Local first: routes live on the device, and sending anything to the server is always the user's choice.

Status: early development (milestone 1, see [BRIEF.md](BRIEF.md) and [PLAN.md](PLAN.md)).
Architecture: [docs/architecture.md](docs/architecture.md).

## Layout

| Path | Content |
| --- | --- |
| `apps/web` | Angular single-page app (no SSR), strict TypeScript |
| `apps/api` | Node.js + Fastify API |
| `libs/shared` | Types and code shared by the web app and the API |
| `docs/` | Architecture document and diagrams |
| `spike/brouter/` | Finished spike validating BRouter locally (see its `RAPPORT.md`) |

## Requirements

- Node.js 24 and npm 11
- Docker (for BRouter and PostGIS, from step 3 of the plan)

## Quick start

```bash
npm install
cp .env.example .env     # optional: the defaults work
npx nx serve api         # http://localhost:3000
npx nx serve web         # http://localhost:4200
```

## Common commands

```bash
npx nx build web         # or: api
npx nx test web          # or: api, shared
npx nx lint web          # or: api, shared
```

During development, run only the tests of the project you changed. Run the whole suite once at the end of a piece of work:

```bash
npx nx run-many -t test
```

## Principles

- **Open:** AGPL code, open data first (OpenStreetMap, Copernicus, IGN).
- **Local first:** routes are stored on the device.
- **Bilingual, English first:** no hard-coded UI string; everything goes through translation keys (`en.json` first, then `fr.json`). Numbers, dates and units go through `Intl` and a formatting layer (metric by default).
- **Replaceable components:** routing, geocoding, tiles and relief sit behind interfaces.
- **No secret in the repository:** configuration comes from environment variables.

## License

[AGPL-3.0-only](LICENSE).
