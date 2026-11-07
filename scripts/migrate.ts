/**
 * Runs node-pg-migrate with the same DATABASE_URL (and local defaults) as the API.
 * Usage: tsx scripts/migrate.ts [up|down] [extra node-pg-migrate args]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../apps/api/src/app/config';

const root = join(__dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const [direction = 'up', ...rest] = process.argv.slice(2);
const result = spawnSync(
  join(root, 'node_modules/.bin/node-pg-migrate'),
  [direction, '-m', join(root, 'apps/api/migrations'), ...rest],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: loadConfig().databaseUrl },
  },
);
process.exit(result.status ?? 1);
