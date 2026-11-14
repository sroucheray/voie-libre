#!/usr/bin/env bash
# Prints the audience statistics of the last days, read from the production database over SSH
# (see docs/features/analytics.md). Read only: nothing is changed on the server.
#
# Usage: DEPLOY_HOST=ubuntu@203.0.113.10 scripts/stats.sh [days]      (default: 14)
# Environment (the same as scripts/deploy.sh):
#   DEPLOY_HOST      user@host of the server (required)
#   DEPLOY_SSH_KEY   private key to use, default: the SSH agent / ~/.ssh config
#   DEPLOY_DIR       directory on the server, default: voie-libre (in the user's home)
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST, e.g. DEPLOY_HOST=ubuntu@203.0.113.10}"
DIR="${DEPLOY_DIR:-voie-libre}"
DAYS="${1:-14}"
[[ "$DAYS" =~ ^[0-9]+$ ]] && [ "$DAYS" -ge 1 ] && [ "$DAYS" -le 400 ] || {
  echo "Usage: $0 [days]  (a number from 1 to 400)" >&2
  exit 1
}

ssh_opts=(-o BatchMode=yes)
[ -z "${DEPLOY_SSH_KEY:-}" ] || ssh_opts+=(-i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes)

# The SQL travels on the standard input; psql runs inside the database container, read only.
sql() {
  cat <<SQL
\\set ON_ERROR_STOP on
\\pset footer off
\\pset null 0
\\echo '== Per day (the last $DAYS days)'
SELECT day,
  sum(count) FILTER (WHERE metric = 'visit') AS visits,
  sum(count) FILTER (WHERE metric = 'unique') AS uniques,
  sum(count) FILTER (WHERE metric = 'route') AS routes,
  sum(count) FILTER (WHERE metric = 'loop') AS loops,
  sum(count) FILTER (WHERE metric = 'save') AS saves,
  sum(count) FILTER (WHERE metric = 'export_gpx') AS gpx,
  sum(count) FILTER (WHERE metric = 'export_fit') AS fit
FROM stats_daily WHERE day > current_date - $DAYS
GROUP BY day ORDER BY day DESC;
\\echo
\\echo '== Visits by language and by device'
SELECT replace(metric, 'visit_', '') AS kind, dimension, sum(count) AS visits
FROM stats_daily
WHERE day > current_date - $DAYS AND metric IN ('visit_language', 'visit_device')
GROUP BY metric, dimension ORDER BY metric, visits DESC;
\\echo
\\echo '== Routes computed, by profile'
SELECT dimension AS profile, sum(count) AS routes,
  round((sum(total) / nullif(sum(count), 0))::numeric, 1) AS mean_km
FROM stats_daily WHERE day > current_date - $DAYS AND metric = 'route'
GROUP BY dimension ORDER BY routes DESC;
\\echo
\\echo '== Routes: means and distance bands'
SELECT 'all routes' AS what,
  sum(count) AS routes,
  round((sum(total) / nullif(sum(count), 0))::numeric, 1) AS mean
FROM stats_daily WHERE day > current_date - $DAYS AND metric = 'route'
UNION ALL
SELECT 'mean points per route', sum(count),
  round((sum(total) / nullif(sum(count), 0))::numeric, 1)
FROM stats_daily WHERE day > current_date - $DAYS AND metric = 'route_points'
UNION ALL
SELECT 'mean stops per route', sum(count),
  round((sum(total) / nullif(sum(count), 0))::numeric, 1)
FROM stats_daily WHERE day > current_date - $DAYS AND metric = 'route_stops';
SELECT dimension AS distance_band, sum(count) AS routes
FROM stats_daily WHERE day > current_date - $DAYS AND metric = 'route_distance'
GROUP BY dimension
ORDER BY array_position(ARRAY['lt20','20-50','50-100','100-200','gt200'], dimension);
SQL
}

sql | ssh "${ssh_opts[@]}" "$DEPLOY_HOST" \
  "cd '$DIR' && docker compose -f docker-compose.prod.yml exec -T -e PGOPTIONS='-c default_transaction_read_only=on' db sh -c 'psql -X -P pager=off -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
