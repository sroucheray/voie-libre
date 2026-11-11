import {
  type Geocoder,
  GeocodingError,
  type GeocodingLanguage,
  type Place,
  type Position,
  type SearchOptions,
} from './geocoder';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5000;
const USER_AGENT = 'voie-libre-api (open-source route planner)';

interface PhotonProperties {
  /** What the feature is: `house`, `street`, `city`, `district`, `locality`, `other`... */
  type?: string;
  name?: string;
  locality?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface PhotonFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: PhotonProperties;
}

/** "name, 12 street, city, country", leaving out what is missing or repeated. */
export function photonLabel(p: PhotonProperties): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [
    p.name,
    street,
    p.city ?? p.district ?? p.county,
    p.country,
  ].filter((part): part is string => !!part);
  return parts.filter((part, i) => part !== parts[i - 1]).join(', ');
}

/** The town, village or district an address belongs to. */
const localityOf = (p: PhotonProperties): string | undefined =>
  p.city ?? p.locality ?? p.district ?? p.county;

/**
 * A short name for a place. A search result is called by its own name, except an address (a
 * house, a street, a place with no name), which is called by its locality. The place found for a
 * click is called by its locality: the click is not on that shop or that street.
 */
export function photonShort(
  p: PhotonProperties,
  mode: 'search' | 'reverse',
): string | undefined {
  if (mode === 'reverse') return localityOf(p) ?? p.name;
  const isAddress = p.type === 'house' || p.type === 'street' || !p.name;
  return isAddress ? (localityOf(p) ?? p.name) : p.name;
}

function toPlace(
  feature: PhotonFeature,
  mode: 'search' | 'reverse',
): Place | null {
  const coordinates = feature.geometry?.coordinates;
  if (
    feature.geometry?.type !== 'Point' ||
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== 'number' ||
    typeof coordinates[1] !== 'number'
  ) {
    return null;
  }
  const label = photonLabel(feature.properties ?? {});
  if (!label) return null;
  const short = photonShort(feature.properties ?? {}, mode);
  return {
    label,
    lon: coordinates[0],
    lat: coordinates[1],
    ...(short ? { short } : {}),
  };
}

/** Photon (https://photon.komoot.io) over HTTP. Only the API calls it, never the browser. */
export class PhotonProvider implements Geocoder {
  readonly name = 'photon';
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async search(
    query: string,
    { lang, limit, near }: SearchOptions,
  ): Promise<Place[]> {
    const params = new URLSearchParams({
      q: query,
      lang,
      limit: String(limit),
    });
    if (near) {
      params.set('lat', String(near.lat));
      params.set('lon', String(near.lon));
    }
    return this.places(`${this.baseUrl}/api?${params}`, 'search');
  }

  async reverse(
    { lon, lat }: Position,
    { lang }: { lang: GeocodingLanguage },
  ): Promise<Place | null> {
    const params = new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      lang,
      limit: '1',
    });
    const [place] = await this.places(
      `${this.baseUrl}/reverse?${params}`,
      'reverse',
    );
    return place ?? null;
  }

  private async places(
    url: string,
    mode: 'search' | 'reverse',
  ): Promise<Place[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GeocodingError('unavailable', 'Photon could not be reached.', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new GeocodingError(
        response.status >= 500 || response.status === 429
          ? 'unavailable'
          : 'provider_error',
        `Photon answered ${response.status}.`,
      );
    }
    let body: { features?: PhotonFeature[] };
    try {
      body = (await response.json()) as { features?: PhotonFeature[] };
    } catch (error) {
      throw new GeocodingError('provider_error', 'Photon sent invalid JSON.', {
        cause: error,
      });
    }
    return (body.features ?? [])
      .map((feature) => toPlace(feature, mode))
      .filter((place): place is Place => place !== null);
  }
}
