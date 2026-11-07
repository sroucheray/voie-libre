#!/usr/bin/env bash
# Cold-start the container with several JVM heap sizes and time a ~148 km route
# (Clermont -> Vichy -> Roanne), sampling container memory with docker stats.
# Usage: [LONLATS='lon,lat|lon,lat'] ./mem-test.sh [heap sizes...]   default: 64M 128M 256M
set -uo pipefail
export LC_ALL=C
cd "$(dirname "$0")"
LONLATS="${LONLATS:-3.087,45.777|3.426,46.128|4.069,46.034}"
URL="http://localhost:17777/brouter?lonlats=${LONLATS}&profile=trekking&alternativeidx=0&format=geojson"
printf '%-8s %-8s %-10s %-12s %s\n' heap status seconds peak_MiB result
for xmx in "${@:-64M 128M 256M}"; do
  for x in $xmx; do
    ./start.sh "$x" >/dev/null
    peak=0
    ( while true; do docker stats brouter --no-stream --format '{{.MemUsage}}' 2>/dev/null | awk '{print $1}' >> /tmp/brouter-mem.$$; sleep 1; done ) &
    sampler=$!
    start=$(date +%s.%N)
    out=$(curl -s -o /tmp/brouter-out.$$ -w '%{http_code}' --max-time 300 "$URL")
    end=$(date +%s.%N)
    kill $sampler 2>/dev/null; wait $sampler 2>/dev/null
    peak=$(awk '{v=$1; if (v ~ /GiB/) v=v*1024; else if (v ~ /KiB/) v=v/1024; sub(/[A-Za-z]+/,"",v); if (v+0>m) m=v+0} END{printf "%d", m}' /tmp/brouter-mem.$$ 2>/dev/null)
    res=$(head -c 120 /tmp/brouter-out.$$ | tr '\n' ' ')
    printf '%-8s %-8s %-10.1f %-12s %s\n' "$x" "$out" "$(echo "$end - $start" | bc)" "$peak" "${res:0:60}"
    rm -f /tmp/brouter-mem.$$ /tmp/brouter-out.$$
  done
done
