import { InjectionToken } from '@angular/core';
import { IndexedDbRouteStore } from './indexeddb-route-store';
import type { ElevationSource } from '../planner/planner-store';
import type { NewSavedRoute, SavedRoute, ShareInfo } from './saved-route';

/**
 * Why a storage operation failed. The UI translates these codes under `saved.errors.*`.
 * - `unavailable`: no usable storage (IndexedDB missing or blocked, e.g. in a private window).
 * - `quota`: the device is out of space.
 * - `not_found`: the route no longer exists (deleted from another tab).
 */
export type RouteStoreErrorCode =
  'unavailable' | 'quota' | 'not_found' | 'unknown';

export class RouteStoreError extends Error {
  constructor(
    readonly code: RouteStoreErrorCode,
    options?: ErrorOptions,
  ) {
    super(`Route storage failed: ${code}`, options);
    this.name = 'RouteStoreError';
  }
}

/**
 * Where saved routes live. Every failure is a {@link RouteStoreError}. The web app uses
 * IndexedDB; a SQLite implementation can replace it under Capacitor without touching the UI.
 */
export interface RouteStore {
  /** Stores a new route and returns it with its id, dates and schema version. */
  save(route: NewSavedRoute): Promise<SavedRoute>;
  /** Every saved route, the most recently created first. */
  list(): Promise<SavedRoute[]>;
  /** `undefined` when no route has this id. */
  get(id: string): Promise<SavedRoute | undefined>;
  /** Throws `not_found` when no route has this id. */
  rename(id: string, name: string): Promise<SavedRoute>;
  /** Remembers that the route is shared (or no longer, with `null`). Throws `not_found`. */
  setShare(id: string, share: ShareInfo | null): Promise<SavedRoute>;
  /** Replaces the geometry and the climb (elevations added later). Throws `not_found`. */
  setElevation(
    id: string,
    geometry: [number, number, number][],
    ascentMeters: number,
    elevationSource?: ElevationSource,
  ): Promise<SavedRoute>;
  /** Deleting an id that does not exist is not an error. */
  delete(id: string): Promise<void>;
}

export const ROUTE_STORE = new InjectionToken<RouteStore>('ROUTE_STORE', {
  providedIn: 'root',
  factory: () => new IndexedDbRouteStore(),
});
