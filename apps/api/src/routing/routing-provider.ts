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
   * a different way. Optional: an engine without it answers "loop by distance" with an error.
   */
  roundTrip?(
    start: Position,
    profile: RoutingProfile,
    avoidZones: AvoidZone[],
    alternatives: number,
    distanceMeters: number,
  ): Promise<RouteResult[]>;
}

/** How a closed route is built (see {@link RoutingProvider.roundTrip} and `routeLoop`). */
export type LoopRequest =
  /** `points` end where they start; the way back avoids the way out where it can. */
  | { mode: 'avoid_outbound' }
  /** `points` are the start twice; the engine draws a loop of about this length. */
  | { mode: 'distance'; distanceMeters: number };

export const MAX_ALTERNATIVES = 4;
