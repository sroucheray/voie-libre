# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx nx build api --skip-nx-cache

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
# Nx writes a package.json listing only what the API imports.
COPY --from=build /repo/dist/apps/api ./
RUN npm install --omit=dev --no-audit --no-fund
USER node
EXPOSE 3000
CMD ["node", "main.js"]
