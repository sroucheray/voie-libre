#!/usr/bin/env bash
# Start the local BRouter container (image built from ./brouter-src).
# Usage: ./start.sh [XMX]   e.g. ./start.sh 512M   (default 512M)
set -euo pipefail
cd "$(dirname "$0")"
XMX="${1:-512M}"
docker rm -f brouter >/dev/null 2>&1 || true
docker run -d --rm \
  -v "$PWD/segments4:/segments4" \
  -p 17777:17777 \
  -e MAXTHREADS=2 \
  -e JAVA_OPTS="-Xmx${XMX} -Xms${XMX} -DmaxRunningTime=300 -DuseRFCMimeType=false" \
  --name brouter \
  brouter
# wait until the HTTP server answers
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:17777/"; then echo "BRouter up (Xmx=${XMX})"; exit 0; fi
  sleep 1
done
echo "BRouter did not start" >&2; docker logs brouter | tail -20; exit 1
