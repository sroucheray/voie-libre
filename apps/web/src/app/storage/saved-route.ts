import type { LngLat } from '../core/map/map-factory';
import type { LoopMode, PlannedRoute, Profile } from '../planner/planner-store';

/**
 * Version of the stored record. Bump it when the shape changes and migrate older records when
 * they are read.
 */
export const SAVED_ROUTE_SCHEMA_VERSION = 1;

/** Kept with a route once a short link was made: what is needed to remove the copy sooner. */
export interface ShareInfo {
  /** Secret returned once by the API; the only way to remove the shared route. Never shown. */
  deleteToken: string;
  /** Milliseconds since the epoch. */
  sharedAt: number;
  /** When the server removes the copy, in milliseconds since the epoch. */
  expiresAt: number;
}

/**
 * A route kept on the device. Only the selected itinerary is stored, never the alternatives, so
 * opening it needs neither the API nor a new computation.
 */
export interface SavedRoute extends PlannedRoute {
  schemaVersion: number;
  /** Short random id, 10 characters. */
  id: string;
  name: string;
  profile: Profile;
  /** The start first, the end last, the waypoints in between. At least two points. */
  points: LngLat[];
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  /**
   * The loop mode the route was computed with (loop by distance, avoiding the way out): without
   * it a loop from a place to itself cannot be calculated again. Absent for other routes and for
   * routes saved before it was kept.
   */
  loop?: LoopMode;
  /**
   * How many times a loop is done in a row (2 to 20), applied when the route is exported: the
   * route itself is kept once. Absent for one lap, and for a route that is no loop.
   */
  laps?: number;
  /** Present while the route is shared by link. The shared copy is a snapshot, never updated. */
  share?: ShareInfo;
}

/** What the caller provides; the store adds the id, the dates and the schema version. */
export type NewSavedRoute = Pick<
  SavedRoute,
  | 'name'
  | 'profile'
  | 'points'
  | 'geometry'
  | 'distanceMeters'
  | 'ascentMeters'
  | 'durationSeconds'
  | 'elevationSource'
  | 'surfaces'
  | 'loop'
>;
