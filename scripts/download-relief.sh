#!/usr/bin/env bash
# Downloads Copernicus GLO-30 elevation tiles into data/relief (not committed): one GeoTIFF per
# 1x1 degree square, 25 to 50 MB each. The API reads them locally to give elevations for points.
# Each tile is skipped when it is already present.
#
# Usage: scripts/download-relief.sh [TILE...]
#   A tile is its south-west corner, e.g. N45E003 = lon 3 to 4, lat 45 to 46.
#   Default: N45E002 N45E003 (the Clermont-Ferrand test region, like the basemap).
# Environment: RELIEF_DIR (default data/relief)
#
# Data: Copernicus DEM GLO-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
# 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved.
# The source must be credited wherever the elevations are shown.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${RELIEF_DIR:-data/relief}"
mkdir -p "$DIR"
tiles=("$@")
[ ${#tiles[@]} -gt 0 ] || tiles=(N45E002 N45E003)
for tile in "${tiles[@]}"; do
  if [[ ! "$tile" =~ ^([NS])([0-9]{2})([EW])([0-9]{3})$ ]]; then
    echo "Bad tile name: $tile (expected like N45E003)" >&2
    exit 1
  fi
  lat="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
  lon="${BASH_REMATCH[3]}${BASH_REMATCH[4]}"
  name="Copernicus_DSM_COG_10_${lat}_00_${lon}_00_DEM"
  target="$DIR/$name.tif"
  if [ -s "$target" ]; then echo "$tile already present"; continue; fi
  echo "Downloading $tile..."
  curl -fL --progress-bar -o "$target.part" "https://copernicus-dem-30m.s3.amazonaws.com/$name/$name.tif"
  mv "$target.part" "$target"
done
echo "Tiles in $DIR"
