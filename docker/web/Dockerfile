# The web server of the production stack: Caddy with the built Angular app inside.
# Build from the repository root after `npx nx build web`:
#   docker build -f docker/web/Dockerfile -t voie-libre/web .
FROM caddy:2-alpine
COPY dist/apps/web/browser /srv
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
