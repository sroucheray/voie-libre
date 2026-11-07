#!/usr/bin/env tsx
// @nx-target-name: serve
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { buildApp } from './app/app';
import { loadConfig } from './app/config';
import { createDatabase } from './db/database';
import { CopernicusElevationProvider } from './relief/copernicus-provider';
import { BRouterProvider } from './routing/brouter-provider';

// Load a local .env when present (from the project or the workspace root). Real environment wins.
for (const dir of [process.cwd(), join(process.cwd(), '../..')]) {
  const file = join(dir, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

/** Relative paths are tried from the project and from the workspace root, like `.env`. */
function resolveDirectory(path: string): string {
  if (isAbsolute(path)) return path;
  const candidates = [process.cwd(), join(process.cwd(), '../..')].map((dir) =>
    join(dir, path),
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  const server = await buildApp({
    config,
    db,
    routing: new BRouterProvider(config.brouterUrl),
    elevation: new CopernicusElevationProvider(
      resolveDirectory(config.reliefDir),
    ),
    logger: { level: config.logLevel },
  });

  const shutdown = async () => {
    await server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.listen({ port: config.port, host: config.host });

  // Lets Nx know the server is ready (only set when Nx waits for it).
  if (process.env['NX_READY_SIGNAL_SOCKET']) {
    // Kept out of the bundler's reach: @nx/js may not be installed at runtime.
    const load = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
    load('@nx/js/ready-signal')
      .then((readySignal) => readySignal.emitReadySignal(server.server))
      .catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
