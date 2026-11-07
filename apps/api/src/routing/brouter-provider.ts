import {
  type AvoidZone,
  MAX_ALTERNATIVES,
  type Position,
  type RouteResult,
  RoutingError,
  type RoutingProfile,
  type RoutingProvider,
} from './routing-provider';

/**
 * Voie Libre profile to BRouter profile. See spike/brouter/RAPPORT.md: `trail` still has to be
 * compared with `hiking-mountain` and `mtb` once the app can draw routes.
 */
export const BROUTER_PROFILES: Record<RoutingProfile, string> = {
  road: 'fastbike',
  gravel: 'gravel',
  trail: 'trekking',
};

type FetchLike = (url: string) => Promise<Response>;

const coordinates = (points: Position[]) =>
  points.map((p) => `${p.lon},${p.lat}`).join(',');

/** Builds the BRouter `nogos`, `polylines` and `polygons` query parameters. */
export function avoidZoneParams(zones: AvoidZone[]): string {
  const circles = zones.filter((z) => z.kind === 'circle');
  const lines = zones.filter((z) => z.kind === 'polyline');
  const polygons = zones.filter((z) => z.kind === 'polygon');
  const parts: string[] = [];
  if (circles.length) {
    parts.push(
      `nogos=${circles.map((z) => `${z.center.lon},${z.center.lat},${z.radiusMeters}`).join('|')}`,
    );
  }
  if (lines.length)
    parts.push(
      `polylines=${lines.map((z) => coordinates(z.points)).join('|')}`,
    );
  if (polygons.length) {
    parts.push(
      `polygons=${polygons.map((z) => coordinates(z.points)).join('|')}`,
    );
  }
  return parts.join('&');
}

/** Calls the BRouter HTTP server (`GET /brouter?lonlats=...&format=geojson`). */
export class BRouterProvider implements RoutingProvider {
  readonly name = 'brouter';
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: FetchLike = (url) => fetch(url),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async route(
    points: Position[],
    profile: RoutingProfile,
    avoidZones: AvoidZone[],
    alternatives: number,
  ): Promise<RouteResult[]> {
    if (points.length < 2) {
      throw new RoutingError(
        'invalid_request',
        'At least two points are required',
      );
    }
    if (
      !Number.isInteger(alternatives) ||
      alternatives < 1 ||
      alternatives > MAX_ALTERNATIVES
    ) {
      throw new RoutingError(
        'invalid_request',
        `alternatives must be an integer between 1 and ${MAX_ALTERNATIVES}`,
      );
    }
    const brouterProfile = BROUTER_PROFILES[profile];
    if (!brouterProfile) {
      throw new RoutingError('invalid_request', `Unknown profile "${profile}"`);
    }

    // BRouter returns one route per request: `alternativeidx` picks which one.
    const urls = Array.from({ length: alternatives }, (_, index) =>
      this.url(points, brouterProfile, avoidZones, index),
    );
    return Promise.all(urls.map((url) => this.fetchRoute(url)));
  }

  /** Built by hand: BRouter expects `,` and `|` unescaped. */
  private url(
    points: Position[],
    profile: string,
    zones: AvoidZone[],
    alternativeIndex: number,
  ) {
    const lonlats = points.map((p) => `${p.lon},${p.lat}`).join('|');
    const query = [
      `lonlats=${lonlats}`,
      `profile=${profile}`,
      `alternativeidx=${alternativeIndex}`,
      'format=geojson',
      avoidZoneParams(zones),
    ].filter(Boolean);
    return `${this.baseUrl}/brouter?${query.join('&')}`;
  }

  private async fetchRoute(url: string): Promise<RouteResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (cause) {
      throw new RoutingError('unavailable', 'BRouter is not reachable', {
        cause,
      });
    }
    const body = await response.text();
    if (!response.ok) {
      // BRouter answers 400 with a plain-text reason when it cannot link the points.
      const code = response.status === 400 ? 'no_route' : 'provider_error';
      throw new RoutingError(
        code,
        `BRouter answered ${response.status}: ${body.slice(0, 200)}`,
      );
    }
    return parseGeoJson(body);
  }
}

/** Converts BRouter's GeoJSON (string-valued properties) to a {@link RouteResult}. */
export function parseGeoJson(body: string): RouteResult {
  try {
    const feature = JSON.parse(body).features[0];
    const properties = feature.properties;
    const geometry = feature.geometry.coordinates as [number, number, number][];
    const result: RouteResult = {
      geometry: geometry.map(([lon, lat, ele]) => [lon, lat, ele ?? 0]),
      distanceMeters: Number(properties['track-length']),
      ascentMeters: Number(properties['filtered ascend']),
      durationSeconds: Number(properties['total-time']),
    };
    const numbers = [
      result.distanceMeters,
      result.ascentMeters,
      result.durationSeconds,
    ];
    if (geometry.length < 2 || numbers.some((n) => !Number.isFinite(n))) {
      throw new Error('missing fields');
    }
    return result;
  } catch (cause) {
    throw new RoutingError('provider_error', 'Unexpected BRouter response', {
      cause,
    });
  }
}
