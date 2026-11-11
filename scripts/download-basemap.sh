#!/usr/bin/env bash
# Prepares the offline-ready basemap in data/basemap (not committed):
#   basemap.pmtiles    the area of BASEMAP_BBOX (France by default, about 4.7 GB at zoom 14),
#                      extracted from a Protomaps planet build (only the needed byte ranges
#                      are downloaded). The app reads only the bytes it shows, so a big file
#                      costs nothing to the user: it is not copied to their device.
#   fonts/ sprites/    glyphs and sprites for the map style, from protomaps/basemaps-assets
# Each step is skipped when its output already exists. Delete a file or folder to fetch it again.
# `docker compose up -d tiles` serves the folder to the web app (with Range requests and CORS).
#
# Usage: scripts/download-basemap.sh
# Environment:
#   BASEMAP_BBOX      min_lon,min_lat,max_lon,max_lat   default: -5.5,41.2,9.8,51.2 (France, Corsica
#                     included). Measured at zoom 14: Angers to Lyon (-1.2,45.2,5.4,47.9) 680 MB,
#                     Europe (-11,35,32,71) 22 GB. Clermont-Ferrand only: 2.6,45.3,3.7,46.1 (42 MB).
#   BASEMAP_MAXZOOM   default: 14
#   BASEMAP_BUILD     planet build file name, e.g. 20261105.pmtiles   default: latest listed
#   PMTILES_BIN       pmtiles CLI to use; default: `pmtiles` if installed, else the Docker image
#
# Data: (c) OpenStreetMap contributors (ODbL), tiles by Protomaps.
# Assets: fonts under the SIL Open Font License, sprites derived from MIT-licensed tangrams/icons.
set -euo pipefail
cd "$(dirname "$0")/.."

BBOX="${BASEMAP_BBOX:--5.5,41.2,9.8,51.2}"
MAXZOOM="${BASEMAP_MAXZOOM:-14}"
OUT_DIR="data/basemap"
TILES="$OUT_DIR/basemap.pmtiles"
# Pinned commit of protomaps/basemaps-assets, so the style and the glyphs always match.
ASSETS_REF="028c18f713baecad011301ff7a69acc39bcc2ae7"
mkdir -p "$OUT_DIR"

extract_tiles() {
  local build="${BASEMAP_BUILD:-}"
  if [ -z "$build" ]; then
    build="$(curl -fsS https://build-metadata.protomaps.dev/builds.json \
      | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(b[b.length-1].key)')"
  fi
  local source="https://build.protomaps.com/$build"
  echo "Extracting bbox $BBOX (max zoom $MAXZOOM) from $source"
  if [ -n "${PMTILES_BIN:-}" ]; then
    "$PMTILES_BIN" extract "$source" "$TILES.part" --bbox="$BBOX" --maxzoom="$MAXZOOM"
  elif command -v pmtiles >/dev/null 2>&1; then
    pmtiles extract "$source" "$TILES.part" --bbox="$BBOX" --maxzoom="$MAXZOOM"
  else
    # No local CLI: use the official image, writing as the current user.
    docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/$OUT_DIR:/out" protomaps/go-pmtiles \
      extract "$source" "/out/basemap.pmtiles.part" --bbox="$BBOX" --maxzoom="$MAXZOOM"
  fi
  mv "$TILES.part" "$TILES"
}

fetch_assets() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  echo "Fetching fonts and sprites (basemaps-assets@${ASSETS_REF:0:7})"
  git clone -q --filter=blob:none --no-checkout --sparse \
    https://github.com/protomaps/basemaps-assets.git "$tmp/repo"
  (
    cd "$tmp/repo"
    # The style only uses these three Noto Sans faces.
    git sparse-checkout set "fonts/Noto Sans Regular" "fonts/Noto Sans Medium" \
      "fonts/Noto Sans Italic" fonts/OFL.txt sprites/v4
    git checkout -q "$ASSETS_REF"
  )
  mkdir -p "$OUT_DIR/fonts.part" "$OUT_DIR/sprites.part"
  cp -r "$tmp/repo/fonts/." "$OUT_DIR/fonts.part/"
  cp -r "$tmp/repo/sprites/." "$OUT_DIR/sprites.part/"
  mv "$OUT_DIR/fonts.part" "$OUT_DIR/fonts"
  mv "$OUT_DIR/sprites.part" "$OUT_DIR/sprites"
}

if [ -s "$TILES" ]; then echo "$TILES already present"; else extract_tiles; fi
if [ -d "$OUT_DIR/fonts" ] && [ -d "$OUT_DIR/sprites" ]; then
  echo "Fonts and sprites already present"
else
  rm -rf "$OUT_DIR/fonts.part" "$OUT_DIR/sprites.part"
  fetch_assets
fi
echo "Basemap ready in $OUT_DIR ($(du -sh "$OUT_DIR" | cut -f1))"
