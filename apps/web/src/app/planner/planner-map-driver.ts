import { InjectionToken } from '@angular/core';
import type { LngLat, MapLike } from '../core/map/map-factory';
import type { LocationFix } from '../location/geolocation';
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
  /** Set on the start marker when clicking it can close the loop: the translated hint. */
  closable?: string;
}

/** The translucent marker that follows the pointer and shows what the next click creates. */
export interface GhostSpec {
  role: PointRole;
  /** Same short text as the marker it will become. */
  label: string;
  /** What the click does, translated: "Click to set the end". */
  text: string;
  /** Said when the pointer rests where no point can be placed (no way for the profile). */
  refusedText: string;
}

/** What the user does on the map, reported to the planner. */
export interface PlannerMapHandlers {
  /** A click on the map, away from any route. */
  onClick(point: LngLat): void;
  /** A click on an alternative route. */
  onSelectRoute(index: number): void;
  /** The start marker was clicked while it offers to close the loop. */
  onCloseLoop(): void;
  /** The selected route was dragged from `hit` (on the route) and dropped at `to`. */
  onInsertPoint(hit: LngLat, to: LngLat): void;
  /** A right click or a long press on the map, at `point` (`screen`: pixels in the map). */
  onContextMenu(point: LngLat, screen: { x: number; y: number }): void;
  /** Marker `index` was dragged and dropped at `point`. */
  onMovePoint(index: number, point: LngLat): void;
  /** A marker, or the route (to insert a point), starts being dragged. */
  onDragStart(): void;
  /** Marker `index` is being dragged and is at `point` for now. */
  onDragPoint(index: number, point: LngLat): void;
  /** The route is being dragged from `hit` and the pointer is at `to` for now. */
  onDragInsert(hit: LngLat, to: LngLat): void;
  onRemovePoint(index: number): void;
  /** The pointer is over the selected route (`point`), or left it (`null`). */
  onHoverRoute(point: LngLat | null): void;
  /**
   * Where a point placed at `point` would land (on the nearest way, for the profiles that need
   * one), for the ghost to show it; `refused` when no point can be placed there.
   */
  ghostAt(point: LngLat): { point: LngLat; refused: boolean };
}

/** The planner's view of the map: draws markers and routes, reports clicks and drags. */
export interface PlannerMapDriver {
  setMarkers(markers: MarkerSpec[]): void;
  /** `routes[selected]` is drawn as the main route, the others as alternatives. */
  setRoutes(routes: LngLat3[][], selected: number): void;
  /**
   * Draws the selected route in the colours of what it rides on (`surfaces`: one character per
   * segment of `geometry`), over its line; `null` removes it.
   */
  setSurfaces(geometry: LngLat3[] | null, surfaces: string | null): void;
  /**
   * The routes on screen are being replaced by a computation that takes a while: they are drawn
   * faded (and back to full when it is over), so that they do not pass for the answer.
   */
  setStale(stale: boolean): void;
  /** Moves the view so that the whole route is visible. */
  fitRoute(geometry: LngLat3[], animate?: boolean): void;
  /** Moves the view so that all these points are visible (a new point was added to a route). */
  fitPoints(points: LngLat[]): void;
  /** Moves the view to a place (a search result), keeping it clear of the panel. */
  centerOn(point: LngLat): void;
  /** Shows the ghost under the pointer (desktop only), or hides it with `null`. */
  setGhost(ghost: GhostSpec | null): void;
  /** Draws a route temporarily (a saved route under the pointer) without moving the view; `null` removes it. */
  setPreview(geometry: LngLat3[] | null): void;
  /** Highlights a stretch of the route (picked on the profile) over its line; `null` removes it. */
  setHighlight(geometry: LngLat3[] | null): void;
  /** Shows a dot at this position (the point hovered on the profile), or hides it. */
  setCursor(point: LngLat | null): void;
  /**
   * Shows where the user is: a dot, the circle of its accuracy and, with a heading, a cone. The
   * first fix after `null` also moves the view there. `null` hides everything.
   */
  setLocation(fix: LocationFix | null): void;
  /** Meters on the ground for one pixel on screen, around `at`. */
  metersPerPixel(at: LngLat): number;
  /** Gives up the drag in progress: nothing is reported for it, the markers are drawn again. */
  cancelDrag(): void;
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
