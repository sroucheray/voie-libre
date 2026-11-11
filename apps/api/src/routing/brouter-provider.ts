import {
  type AvoidZone,
  MAX_ALTERNATIVES,
  type Position,
  type RouteResult,
  RoutingError,
  type RoutingProfile,
  type RoutingProvider,
} from './routing-provider';
import { retracedRatio, trimSpurs } from './spurs';
import { surfacesFromMessages } from './surface';

/**
 * Voie Libre profile to BRouter profile. `trail` uses `hiking-mountain`: on the Clermont test region
 * it stays 59-66% on paths and tracks with almost no main road, where `trekking` (a touring-bike
 * profile) takes 14-35% main roads. `mtb` is the candidate for a future mountain-bike profile.
 */
export const BROUTER_PROFILES: Record<RoutingProfile, string> = {
  road: 'fastbike',
  gravel: 'gravel',
  trail: 'hiking-mountain',
};

/** A BRouter loop is about this many times its radius long. */
const ROUND_TRIP_RATIO = 5.5;
const ROUND_TRIP_TRIES = 3;
/** Close enough to the asked length: 10%. */
const ROUND_TRIP_TOLERANCE = 0.1;
/** Directions tried (45° apart) when a climb is asked for: more candidates to choose from. */
const ASCENT_DIRECTIONS = 8;
/** Around a preferred heading, loops spread by this step, on one side then the other. */
const HEADING_SPREAD_DEGREES = 25;
/** Headings tried around a preferred one when a climb is asked for too. */
const ASCENT_HEADINGS = 5;

/**
 * The headings to try. Without a preference they are spread evenly around the compass; with one
 * they stay close to it: the heading itself, then steps on its right and on its left.
 */
export function loopHeadings(count: number, preferred?: number): number[] {
  if (preferred === undefined) {
    return Array.from({ length: count }, (_, index) =>
      Math.round((index * 360) / count),
    );
  }
  return Array.from({ length: count }, (_, index) => {
    const step = Math.ceil(index / 2) * HEADING_SPREAD_DEGREES;
    const heading = preferred + (index % 2 === 1 ? step : -step);
    return Math.round(((heading % 360) + 360) % 360);
  });
}

/** Distance from the asked climb, as a fraction of it (of 100 m at least, so 0 can be asked). */
function ascentError(ascent: number | null, target: number): number {
  return Math.abs((ascent ?? 0) - target) / Math.max(target, 100);
}

type FetchLike = (url: string) => Promise<Response>;

/**
 * BRouter serves `MAXTHREADS` requests at once (2 in docker-compose.yml). One more does not wait:
 * after 2 s BRouter kills a running request, which then answers 400. So calls queue here.
 */
export const DEFAULT_MAX_CONCURRENT = 2;

/** Runs at most `limit` tasks at once, the others wait in order. */
function limiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      // The slot goes straight to the next in line, so `running` stays as it is.
      if (next) next();
      else running--;
    }
  };
}

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
  private readonly limited: <T>(task: () => Promise<T>) => Promise<T>;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: FetchLike = (url) => fetch(url),
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.limited = limiter(maxConcurrent);
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
    const [best, ...others] = await Promise.all(
      urls.map((url, index) =>
        this.fetchRoute(url).catch((error: unknown) => {
          // The best route must exist; an alternative the engine cannot find is left out.
          if (
            index > 0 &&
            error instanceof RoutingError &&
            error.code === 'no_route'
          ) {
            return null;
          }
          throw error;
        }),
      ),
    );
    return [best, ...others].filter(
      (route): route is RouteResult => route !== null,
    );
  }

  /**
   * BRouter's round trip takes a radius, not a length: the loop comes out at about 5 times the
   * radius, and by how much depends on the roads and on the direction. So the radius is
   * corrected from what comes back, up to {@link ROUND_TRIP_TRIES} calls. BRouter sometimes goes
   * to a far point and back by the same road: those spurs are cut out of each answer (so the
   * radius is corrected on the length that is left), and the loop closest to the target with the
   * least road driven twice wins. Alternatives head in evenly spaced directions, or close to
   * `headingDegrees` when one is preferred.
   */
  async roundTrip(
    start: Position,
    profile: RoutingProfile,
    avoidZones: AvoidZone[],
    alternatives: number,
    distanceMeters: number,
    ascentMeters?: number,
    headingDegrees?: number,
  ): Promise<RouteResult[]> {
    const brouterProfile = BROUTER_PROFILES[profile];
    if (!brouterProfile) {
      throw new RoutingError('invalid_request', `Unknown profile "${profile}"`);
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
    // The engine cannot aim at a climb: with a target, loops head in more directions and the ones
    // whose climb comes closest are kept.
    const tries =
      ascentMeters === undefined
        ? alternatives
        : headingDegrees === undefined
          ? ASCENT_DIRECTIONS
          : Math.max(alternatives, ASCENT_HEADINGS);
    const loops = await Promise.all(
      loopHeadings(tries, headingDegrees).map((heading) =>
        this.roundTripToward(
          start,
          brouterProfile,
          avoidZones,
          heading,
          distanceMeters,
        ),
      ),
    );
    if (ascentMeters === undefined) return loops;
    return loops
      .map((route) => ({
        route,
        error: ascentError(route.ascentMeters, ascentMeters),
      }))
      .sort((a, b) => a.error - b.error)
      .slice(0, alternatives)
      .map(({ route }) => route);
  }

  private async roundTripToward(
    start: Position,
    profile: string,
    zones: AvoidZone[],
    direction: number,
    target: number,
  ): Promise<RouteResult> {
    let radius = target / ROUND_TRIP_RATIO;
    let best: RouteResult | null = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < ROUND_TRIP_TRIES; attempt++) {
      const query = [
        `lonlats=${start.lon},${start.lat}`,
        `profile=${profile}`,
        'alternativeidx=0',
        'format=geojson',
        'engineMode=4',
        `roundTripDistance=${Math.round(radius)}`,
        `direction=${direction}`,
        avoidZoneParams(zones),
      ].filter(Boolean);
      const route = trimSpurs(
        await this.fetchRoute(`${this.baseUrl}/brouter?${query.join('&')}`),
      );
      // Distance error and share of road driven twice, both as fractions of a whole.
      const score =
        Math.abs(route.distanceMeters - target) / target +
        retracedRatio(route.geometry);
      if (score < bestScore) {
        best = route;
        bestScore = score;
      }
      const error = Math.abs(route.distanceMeters - target) / target;
      if (error <= ROUND_TRIP_TOLERANCE || route.distanceMeters <= 0) break;
      // Length grows about linearly with the radius: scale it, within sane bounds.
      const scale = Math.min(3, Math.max(0.33, target / route.distanceMeters));
      radius *= scale;
    }
    return best as RouteResult;
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
      response = await this.limited(() => this.fetchImpl(url));
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
    const surfaces = surfacesFromMessages(properties.messages, geometry);
    if (surfaces !== undefined) result.surfaces = surfaces;
    return result;
  } catch (cause) {
    throw new RoutingError('provider_error', 'Unexpected BRouter response', {
      cause,
    });
  }
}
