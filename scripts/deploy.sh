#!/usr/bin/env bash
# Builds the production images on this machine and starts them on the server (see BRIEF-deploy.md).
#
# Usage: DEPLOY_HOST=ubuntu@203.0.113.10 scripts/deploy.sh
# Environment:
#   DEPLOY_HOST      user@host of the server (required)
#   DEPLOY_SSH_KEY   private key to use, default: the SSH agent / ~/.ssh config
#   DEPLOY_DIR       directory on the server, default: voie-libre (in the user's home)
#
# What it does: nx build web, `docker compose build` (web, api, migrate, brouter), sends the images
# with `docker save | ssh docker load` (no registry), copies the compose file and the tiles
# server's configuration, then `docker compose up -d --no-build`.
# What it does not do: create `.env` (copy .env.production.example there once, set the password)
# or fetch the data (scripts/download-segments.sh and scripts/download-basemap.sh, run on the
# server). Nothing secret travels: `.env` stays on the server.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEPLOY_HOST:?set DEPLOY_HOST, e.g. DEPLOY_HOST=ubuntu@203.0.113.10}"
DIR="${DEPLOY_DIR:-voie-libre}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
IMAGES=(voie-libre/web voie-libre/api voie-libre/migrate voie-libre/brouter)

ssh_opts=(-o BatchMode=yes)
[ -z "${DEPLOY_SSH_KEY:-}" ] || ssh_opts+=(-i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes)
remote() { ssh "${ssh_opts[@]}" "$DEPLOY_HOST" "$@"; }

echo "==> Checking the server"
remote "test -f '$DIR/.env'" || {
  echo "No $DIR/.env on the server: copy .env.production.example there and set POSTGRES_PASSWORD." >&2
  echo "(mkdir -p $DIR first; see docs/deployment.md)" >&2
  exit 1
}

echo "==> Building the web app"
npx nx build web

echo "==> Building the images"
# Build-time values only: compose asks for them to read the file, no image keeps them.
POSTGRES_PASSWORD=build SITE_DOMAIN=build "${COMPOSE[@]}" build

echo "==> Sending the images"
docker save "${IMAGES[@]}" | gzip | remote "gunzip | docker load"

echo "==> Sending the stack files"
tar -c docker-compose.prod.yml docker/tiles/default.conf | remote "mkdir -p '$DIR' && tar -x -C '$DIR'"

echo "==> Starting"
remote "cd '$DIR' && docker compose -f docker-compose.prod.yml up -d --no-build --remove-orphans && docker compose -f docker-compose.prod.yml ps"
echo "Done."
