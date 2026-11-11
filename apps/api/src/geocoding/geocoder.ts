export const GEOCODING_LANGUAGES = ['en', 'fr'] as const;
export type GeocodingLanguage = (typeof GEOCODING_LANGUAGES)[number];

export interface Position {
  lon: number;
  lat: number;
}

/** A place found by a geocoder: a display label and where it is. */
export interface Place extends Position {
  label: string;
  /**
   * A short name to call the place by, e.g. in the name of a route: its own name for a place that
   * was searched (`Puy de Dôme`, `Issoire`), the town, village or district for an address or a
   * place found for a click. Absent when the provider tells neither.
   */
  short?: string;
}

export interface SearchOptions {
  lang: GeocodingLanguage;
  limit: number;
  /** Favours places close to this position without excluding the others. */
  near?: Position;
}

/**
 * Turns text into places and positions into addresses. Like routing and relief, the provider
 * sits behind this interface so the public Photon server can be replaced by an own instance.
 */
export interface Geocoder {
  readonly name: string;
  search(query: string, options: SearchOptions): Promise<Place[]>;
  /** The nearest address or place, or `null` when there is nothing around. */
  reverse(
    position: Position,
    options: { lang: GeocodingLanguage },
  ): Promise<Place | null>;
}

export type GeocodingErrorCode = 'unavailable' | 'provider_error';

export class GeocodingError extends Error {
  constructor(
    readonly code: GeocodingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GeocodingError';
  }
}
