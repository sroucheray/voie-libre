import type { LngLat } from '../core/map/map-factory';
import type { PlannedRoute, Profile } from '../planner/planner-store';

/**
 * Version of the stored record. Bump it when the shape changes and migrate older records when
 * they are read.
 */
export const SAVED_ROUTE_SCHEMA_VERSION = 1;

/** Kept with a route once it is shared by link: what is needed to stop sharing it later. */
export interface ShareInfo {
  /** Secret returned once by the API; the only way to remove the shared route. Never shown. */
  deleteToken: string;
  /** Milliseconds since the epoch. */
  sharedAt: number;
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
>;
