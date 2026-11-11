#!/usr/bin/env bash
# Downloads Copernicus GLO-30 elevation tiles into data/relief (not committed): one GeoTIFF per
# 1x1 degree square, 25 to 50 MB each. The API reads them locally to give elevations for points,
# and `npm run build-relief` turns them into the map's hillshade tiles.
# Each tile is skipped when it is already present; a square the bucket does not have (open sea)
# is skipped too.
#
# Usage: scripts/download-relief.sh [france | TILE...]
#   A tile is its south-west corner, e.g. N45E003 = lon 3 to 4, lat 45 to 46.
#   france   every square of -5 to 10 degrees E, 41 to 51 degrees N (133 of the 150 exist, 4.6 GB,
#            measured on 2026-11-11), four downloads at a time.
#   Default: N45E002 N45E003 (the Clermont-Ferrand test region).
# Environment: RELIEF_DIR (default data/relief), RELIEF_JOBS (parallel downloads, default 4)
#
# Data: Copernicus DEM GLO-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
# 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved.
# The source must be credited wherever the elevations are shown.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${RELIEF_DIR:-data/relief}"
JOBS="${RELIEF_JOBS:-4}"
mkdir -p "$DIR"

# The tile names of a region: south-west corners, latitude then longitude.
france_tiles() {
  local lat lon ns ew
  for lat in $(seq 41 50); do
    for lon in $(seq -5 9); do
      ns=N; ew=E
      [ "$lon" -lt 0 ] && ew=W
      printf '%s%02d%s%03d\n' "$ns" "$lat" "$ew" "${lon#-}"
    done
  done
}

download_one() {
  local tile="$1" dir="$2"
  if [[ ! "$tile" =~ ^([NS])([0-9]{2})([EW])([0-9]{3})$ ]]; then
    echo "Bad tile name: $tile (expected like N45E003)" >&2
    return 1
  fi
  local lat="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
  local lon="${BASH_REMATCH[3]}${BASH_REMATCH[4]}"
  local name="Copernicus_DSM_COG_10_${lat}_00_${lon}_00_DEM"
  local target="$dir/$name.tif"
  if [ -s "$target" ]; then echo "$tile already present"; return 0; fi
  local status
  status="$(curl -sL -o "$target.part" -w '%{http_code}' \
    "https://copernicus-dem-30m.s3.amazonaws.com/$name/$name.tif" || true)"
  if [ "$status" = "200" ]; then
    mv "$target.part" "$target"
    echo "Downloaded $tile"
  else
    rm -f "$target.part"
    if [ "$status" = "404" ] || [ "$status" = "403" ]; then
      echo "No data for $tile (open sea)"
    else
      echo "Failed $tile (HTTP $status)" >&2
      return 1
    fi
  fi
}
export -f download_one

if [ "${1:-}" = "france" ]; then
  tiles=($(france_tiles))
else
  tiles=("$@")
  [ ${#tiles[@]} -gt 0 ] || tiles=(N45E002 N45E003)
fi

printf '%s\n' "${tiles[@]}" | xargs -P "$JOBS" -I{} bash -c 'download_one "$1" "$2"' _ {} "$DIR"
echo "Tiles in $DIR: $(ls "$DIR"/*.tif 2>/dev/null | wc -l) ($(du -sh "$DIR" | cut -f1))"
