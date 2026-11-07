import { InjectionToken } from '@angular/core';
import type { LngLat, MapLike } from '../core/map/map-factory';
import type { PointRole } from './planner-store';
import { createMapLibreDriver } from './maplibre-driver';

/** What to draw for one point of the route. Labels are already translated. */
export interface MarkerSpec {
  lngLat: LngLat;
  role: PointRole;
  /** Short text shown on the marker: `A`, `B` or the waypoint number. */
  label: string;
  /** Accessible name, e.g. "Waypoint 1". */
  ariaLabel: string;
  /** The start and end share a place: one combined marker stands for both. */
  loop?: boolean;
}

/** What the user does on the map, reported to the planner. */
export interface PlannerMapHandlers {
  /** A click on the map, away from any route. */
  onClick(point: LngLat): void;
  /** A click on an alternative route. */
  onSelectRoute(index: number): void;
  onMovePoint(index: number, point: LngLat): void;
  onRemovePoint(index: number): void;
  /** The pointer is over the selected route (`point`), or left it (`null`). */
  onHoverRoute(point: LngLat | null): void;
}

/** The planner's view of the map: draws markers and routes, reports clicks and drags. */
export interface PlannerMapDriver {
  setMarkers(markers: MarkerSpec[]): void;
  /** `routes[selected]` is drawn as the main route, the others as alternatives. */
  setRoutes(routes: LngLat3[][], selected: number): void;
  /** Moves the view so that the whole route is visible. */
  fitRoute(geometry: LngLat3[]): void;
  /** Shows a dot at this position (the point hovered on the profile), or hides it. */
  setCursor(point: LngLat | null): void;
  destroy(): void;
}

/** `[longitude, latitude, elevation]`. */
export type LngLat3 = [number, number, number];

export type PlannerMapDriverFactory = (
  map: MapLike,
  handlers: PlannerMapHandlers,
) => Promise<PlannerMapDriver>;

/** Replaced by a fake in tests, so they need neither WebGL nor MapLibre. */
export const PLANNER_MAP_DRIVER = new InjectionToken<PlannerMapDriverFactory>(
  'PLANNER_MAP_DRIVER',
  { providedIn: 'root', factory: () => createMapLibreDriver },
);
