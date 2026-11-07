import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './schema';

export type { components, operations, paths } from './schema';

/**
 * Typed HTTP client for the Voie Libre API. Types come from `schema.d.ts`, generated from
 * the API's `/openapi.json` by `npm run generate-client`: never edit that file by hand.
 */
export function createApiClient(options: ClientOptions) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
