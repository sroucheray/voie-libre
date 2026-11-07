/**
 * Generates packages/api-client from the API's OpenAPI document.
 *
 * The app is built in-process and queried with `inject`, so no server and no database are needed.
 * Output: packages/api-client/openapi.json (the spec) and src/schema.d.ts (TypeScript types).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../apps/api/src/app/app';
import { loadConfig } from '../apps/api/src/app/config';

const root = join(__dirname, '..');
const clientDir = join(root, 'packages/api-client');
const specPath = join(clientDir, 'openapi.json');
const schemaPath = join(clientDir, 'src/schema.d.ts');

async function main() {
  const app = await buildApp({
    config: loadConfig({}),
    db: { ping: async () => true, close: async () => undefined },
    // Only the schemas matter here: nothing is routed while generating.
    routing: { name: 'none', route: async () => [] },
  });
  await app.ready();
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });
  await app.close();
  if (response.statusCode !== 200) {
    throw new Error(`GET /openapi.json answered ${response.statusCode}`);
  }
  writeFileSync(specPath, JSON.stringify(response.json(), null, 2) + '\n');

  const bin = (name: string) => join(root, 'node_modules/.bin', name);
  execFileSync(bin('openapi-typescript'), [specPath, '-o', schemaPath], {
    stdio: 'inherit',
  });
  execFileSync(bin('prettier'), ['--write', specPath, schemaPath], {
    stdio: 'inherit',
  });
  console.log('api-client generated from /openapi.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
