import type { LngLat } from '../core/map/map-factory';
import type { PlannedRoute, Profile } from '../planner/planner-store';

/**
 * Version of the stored record. Bump it when the shape changes and migrate older records when
 * they are read.
 */
export const SAVED_ROUTE_SCHEMA_VERSION = 1;

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
>;
