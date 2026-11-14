#!/usr/bin/env bash
# Downloads BRouter routing segments (not committed: about 120 MB per tile).
# Usage: scripts/download-segments.sh [TILE...|france]   default: E0_N45 (Clermont-Ferrand test region)
# `france` is the seven tiles that cover metropolitan France, Corsica and the north coast included
# (about 850 MB): W5_N40 W5_N45 E0_N40 E0_N45 E0_N50 E5_N40 E5_N45.
# Each tile is a 5x5 degree square named after its south-west corner, e.g. E0_N45 = lon 0-5, lat 45-50.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${BROUTER_SEGMENTS_DIR:-data/brouter/segments4}"
mkdir -p "$DIR"
tiles=("$@")
if [ "${tiles[0]:-}" = "france" ]; then
  tiles=(W5_N40 W5_N45 E0_N40 E0_N45 E0_N50 E5_N40 E5_N45)
fi
[ ${#tiles[@]} -gt 0 ] || tiles=(E0_N45)
for tile in "${tiles[@]}"; do
  target="$DIR/$tile.rd5"
  if [ -s "$target" ]; then echo "$tile already present"; continue; fi
  echo "Downloading $tile..."
  curl -fL --progress-bar -o "$target.part" "https://brouter.de/brouter/segments4/$tile.rd5"
  mv "$target.part" "$target"
done
echo "Segments in $DIR"
