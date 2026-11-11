import { Injectable, inject } from '@angular/core';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import type { LngLat } from '../core/map/map-factory';
import { errorCodeFrom } from '../planner/route-planner';

/** A place found by the API: a label to show and where it is. */
export interface FoundPlace {
  label: string;
  /** A short name to call the place by (a route name, say); absent when the API gave none. */
  short?: string;
  point: LngLat;
}

/** Error codes the search UI translates under `planner.search.errors.*`. */
export type SearchErrorCode =
  'invalid_request' | 'unavailable' | 'rate_limited' | 'unknown';

export type SearchResult =
  { places: FoundPlace[] } | { error: SearchErrorCode };

function searchError(status: number, body: unknown): SearchErrorCode {
  const code = errorCodeFrom(status, body);
  return code === 'invalid_request' ||
    code === 'unavailable' ||
    code === 'rate_limited'
    ? code
    : 'unknown';
}

/** Place and address search through the API: the browser never calls a geocoder itself. */
@Injectable({ providedIn: 'root' })
export class GeocodingService {
  private readonly client = inject(API_CLIENT);
  private readonly language = inject(LanguageService);

  /** Places matching `query`, those near `near` first. An aborted request resolves to `null`. */
  async search(
    query: string,
    signal: AbortSignal,
    near?: LngLat,
  ): Promise<SearchResult | null> {
    try {
      const { data, error, response } = await this.client.GET('/geocode', {
        params: {
          query: {
            q: query,
            lang: this.language.current(),
            ...(near ? { lon: near[0], lat: near[1] } : {}),
          },
        },
        signal,
      });
      if (!data) return { error: searchError(response.status, error) };
      return {
        places: data.places.map((p) => ({
          label: p.label,
          ...(p.short ? { short: p.short } : {}),
          point: [p.lon, p.lat] as LngLat,
        })),
      };
    } catch (error) {
      if (signal.aborted) return null;
      return { error: 'unavailable' };
    }
  }

  /** The address or place nearest to `point`, or `null` (nothing there, offline, or an error). */
  async reverse(
    point: LngLat,
    signal?: AbortSignal,
  ): Promise<{ label: string; short?: string } | null> {
    try {
      const { data } = await this.client.GET('/geocode/reverse', {
        params: {
          query: {
            lon: point[0],
            lat: point[1],
            lang: this.language.current(),
          },
        },
        signal,
      });
      const place = data?.place;
      if (!place) return null;
      return {
        label: place.label,
        ...(place.short ? { short: place.short } : {}),
      };
    } catch {
      return null;
    }
  }
}
