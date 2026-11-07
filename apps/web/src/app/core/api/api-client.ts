import { InjectionToken, inject } from '@angular/core';
import { ApiClient, createApiClient } from '@voie-libre/api-client';

/** Base URL of the Voie Libre API. Override in `app.config.ts` per environment. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:3000',
});

/** Typed client generated from the API's OpenAPI document (see packages/api-client). */
export const API_CLIENT = new InjectionToken<ApiClient>('API_CLIENT', {
  providedIn: 'root',
  factory: () => {
    const baseUrl = inject(API_BASE_URL);
    return createApiClient({
      baseUrl,
      // openapi-fetch captures `fetch` when created: bind lazily so test doubles keep working.
      fetch: (request) => globalThis.fetch(request),
    });
  },
});
