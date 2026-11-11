import { InjectionToken, inject } from '@angular/core';
import { ApiClient, createApiClient } from '@voie-libre/api-client';
import { currentBaseUrls } from './base-urls';

/** Base URL of the Voie Libre API: a local port in development, `/api` of the page's origin otherwise. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => currentBaseUrls().api,
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
