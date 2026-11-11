/** Where the API and the basemap are, for the page at `location` (pure, so it can be tested). */
export interface BaseUrls {
  api: string;
  tiles: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * On the developer's machine (also `npm run serve:prod`) the API and the tiles server are two
 * local ports. Anywhere else the reverse proxy serves everything from the page's own origin:
 * the API under `/api` and the basemap under `/tiles`, so there is no CORS and one certificate.
 */
export function baseUrlsFor(location: {
  hostname: string;
  origin: string;
}): BaseUrls {
  if (LOCAL_HOSTS.has(location.hostname)) {
    return { api: 'http://localhost:3000', tiles: 'http://localhost:8081' };
  }
  return { api: `${location.origin}/api`, tiles: `${location.origin}/tiles` };
}

/** The addresses for the page being shown (the local ones when there is no page, as in tests). */
export function currentBaseUrls(): BaseUrls {
  return typeof location === 'undefined'
    ? baseUrlsFor({ hostname: 'localhost', origin: 'http://localhost' })
    : baseUrlsFor(location);
}
