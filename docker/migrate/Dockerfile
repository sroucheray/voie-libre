# Applies the SQL migrations of apps/api/migrations to the database, then exits.
# The same versions as package-lock.json. Build from the repository root:
#   docker build -f docker/migrate/Dockerfile -t voie-libre/migrate .
# DATABASE_URL comes from the environment (see docker-compose.prod.yml).
FROM node:24-slim
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund node-pg-migrate@9.0.0 pg@8.23.1
COPY apps/api/migrations ./migrations
USER node
CMD ["npx", "node-pg-migrate", "up", "-m", "migrations"]
