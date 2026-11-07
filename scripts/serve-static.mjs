#!/usr/bin/env node
// Serves a built single-page app, falling back to index.html for paths that are not files
// (the app has client-side routes such as /p/abc123xy). Used by `npm run serve:prod`.
// A real host needs the same rule: any path that is not a file answers index.html.
//
// Usage: node scripts/serve-static.mjs [DIR] [PORT]   default: dist/apps/web/browser 4300
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/apps/web/browser');
const port = Number(process.argv[3] ?? 4300);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

async function fileFor(urlPath) {
  const path = resolve(join(root, normalize(decodeURIComponent(urlPath))));
  if (path !== root && !path.startsWith(root + sep)) return null;
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    let file = await fileFor(pathname);
    // A missing file with an extension is a real 404 (a stale asset), not an app route.
    if (!file && extname(pathname) === '') file = join(root, 'index.html');
    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // The service worker script and the app shell must never be served stale.
      'cache-control':
        file.endsWith('index.html') ||
        file.endsWith('ngsw.json') ||
        file.endsWith('ngsw-worker.js')
          ? 'no-cache'
          : 'public, max-age=3600',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(400).end('Bad request');
  }
}).listen(port, () =>
  console.log(`Serving ${root} on http://localhost:${port}`),
);
