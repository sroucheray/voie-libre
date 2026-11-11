/** A WGS84 position in decimal degrees. */
export interface Position {
  lon: number;
  lat: number;
}

/** Profiles exposed by Voie Libre; each provider maps them to its own engine profiles. */
export type RoutingProfile = 'road' | 'gravel' | 'trail';

export const ROUTING_PROFILES: readonly RoutingProfile[] = [
  'road',
  'gravel',
  'trail',
];

/** An area the route must not cross. */
export type AvoidZone =
  | { kind: 'circle'; center: Position; radiusMeters: number }
  | { kind: 'polyline'; points: Position[] }
  | { kind: 'polygon'; points: Position[] };

/** A computed route. */
export interface RouteResult {
  /** `[lon, lat, elevationMeters]` per point. */
  geometry: [number, number, number][];
  distanceMeters: number;
  ascentMeters: number;
  durationSeconds: number;
  /**
   * What the route rides on, one {@link SurfaceCode} character per segment of the geometry
   * (`geometry.length - 1`). Absent when the engine does not tell.
   */
  surfaces?: string;
}

export type RoutingErrorCode =
  | 'invalid_request'
  /** The engine could not link the points (off-network, outside the data, too far). */
  | 'no_route'
  /** The engine could not be reached. */
  | 'unavailable'
  /** The engine answered with something unexpected. */
  | 'provider_error';

/** Error with a stable code: the API returns codes and the app translates them. */
export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RoutingError';
  }
}

/**
 * The swappable "routing provider" (BRouter today, GraphHopper later for loops).
 *
 * @param points start, optional waypoints, end (at least two, in order)
 * @param profile Voie Libre profile
 * @param avoidZones areas to avoid
 * @param alternatives how many routes to return (1 to {@link MAX_ALTERNATIVES}); the first is the best
 */
export interface RoutingProvider {
  readonly name: string;
  route(
    points: Position[],
    profile: RoutingProfile,
    avoidZones: AvoidZone[],
    alternatives: number,
  ): Promise<RouteResult[]>;

  /**
   * Draws loops from `start` of about `distanceMeters`, one per alternative, each one heading
   * a different way. With `ascentMeters` the loops closest to that climb are kept (approached, not
   * guaranteed: the engine cannot aim at a climb). With `headingDegrees` (clockwise from north)
   * every loop heads about that way instead. Optional: an engine without it answers "loop by
   * distance" with an error.
   */
  roundTrip?(
    start: Position,
    profile: RoutingProfile,
    avoidZones: AvoidZone[],
    alternatives: number,
    distanceMeters: number,
    ascentMeters?: number,
    headingDegrees?: number,
  ): Promise<RouteResult[]>;
}

/** The ways a loop by distance can be asked to head, clockwise from north. */
export const LOOP_DIRECTIONS = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
] as const;
export type LoopDirection = (typeof LOOP_DIRECTIONS)[number];

/** The heading of a direction, in degrees clockwise from north. */
export function headingOf(direction: LoopDirection): number {
  return LOOP_DIRECTIONS.indexOf(direction) * (360 / LOOP_DIRECTIONS.length);
}

/** How a closed route is built (see {@link RoutingProvider.roundTrip} and `routeLoop`). */
export type LoopRequest =
  /** `points` end where they start; the way back avoids the way out where it can. */
  | { mode: 'avoid_outbound' }
  /** `points` are the start twice; the engine draws a loop of about this length. */
  | {
      mode: 'distance';
      distanceMeters: number;
      ascentMeters?: number;
      direction?: LoopDirection;
    };

export const MAX_ALTERNATIVES = 4;
