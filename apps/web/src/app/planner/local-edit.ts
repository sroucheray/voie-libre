import type { LngLat } from '../core/map/map-factory';
import { climbOf } from '../import/gpx-import';
import { haversine } from './elevation-profile';
import { nearestVertex, pointVertices } from './insert-point';
import type { LngLat3 } from './planner-map-driver';
import type { PlannedRoute, PointEdit } from './planner-store';

/** A local edit never replaces less than this much route on each side of the point. */
export const WINDOW_FLOOR_METERS = 500;
/** ... and replaces this many times the distance from the point to the route, if that is more. */
export const WINDOW_FACTOR = 2;

/** A stretch of a route, as the range of its vertices, both included. */
export interface EditWindow {
  from: number;
  to: number;
}

/** What the API answered for the window: the new stretch and its figures. */
export interface Stretch {
  geometry: LngLat3[];
  distanceMeters: number;
  ascentMeters: number | null;
  durationSeconds: number;
}

/** Distance along the route of each vertex, in meters (first is 0). */
export function cumulativeDistances(geometry: readonly LngLat3[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < geometry.length; i++) {
    cumulative.push(
      cumulative[i - 1] + haversine(geometry[i - 1], geometry[i]),
    );
  }
  return cumulative;
}

/**
 * The vertex of the route closest to `point`, and how far that is: where a point placed on or
 * beside the route meets it.
 */
export function projectOnRoute(
  geometry: readonly LngLat3[],
  point: LngLat,
): { index: number; distanceMeters: number } {
  const index = nearestVertex(geometry, point, 0);
  return {
    index,
    distanceMeters: haversine(geometry[index], [point[0], point[1], 0]),
  };
}

/**
 * The stretch of the route to recompute around vertex `centre`: `max(WINDOW_FLOOR_METERS,
 * WINDOW_FACTOR × offsetMeters)` on each side, where `offsetMeters` is how far the point is from
 * the route (or how far it was moved). It never goes beyond the vertices `min` and `max` (the
 * neighbouring points, or the ends of the route) and always spans at least two vertices.
 */
export function editWindow(
  geometry: readonly LngLat3[],
  centre: number,
  offsetMeters: number,
  bounds: { min: number; max: number } = { min: 0, max: geometry.length - 1 },
): EditWindow {
  const cumulative = cumulativeDistances(geometry);
  const half = Math.max(WINDOW_FLOOR_METERS, WINDOW_FACTOR * offsetMeters);
  let from = centre;
  while (from > bounds.min && cumulative[centre] - cumulative[from] < half) {
    from--;
  }
  let to = centre;
  while (to < bounds.max && cumulative[to] - cumulative[centre] < half) {
    to++;
  }
  if (from === to) {
    if (to < geometry.length - 1) to++;
    else from--;
  }
  return { from, to };
}

/** The route with the vertices of `window` replaced by `stretch`: the rest is kept as it was. */
export function spliceGeometry(
  geometry: readonly LngLat3[],
  window: EditWindow,
  stretch: readonly LngLat3[],
): LngLat3[] {
  return [
    ...geometry.slice(0, window.from),
    ...stretch,
    ...geometry.slice(window.to + 1),
  ];
}

/**
 * The route after replacing `window` with `stretch`. Distance and duration of the parts kept are
 * those of the route scaled to the geometry (the API's figures and the sum of the vertex gaps
 * differ slightly); the climb loses what the replaced vertices climbed. `elevationSource` and
 * every other field of the route are kept.
 */
export function applyStretch(
  route: PlannedRoute,
  window: EditWindow,
  stretch: Stretch,
): PlannedRoute {
  const { geometry } = route;
  const cumulative = cumulativeDistances(geometry);
  const total = cumulative[cumulative.length - 1] || 1;
  const removed = cumulative[window.to] - cumulative[window.from];
  const keptShare = (total - removed) / total;

  const removedClimb = climbOf(
    geometry.slice(window.from, window.to + 1).map((p) => p[2]),
  );
  const ascentMeters =
    route.ascentMeters === null || stretch.ascentMeters === null
      ? null
      : Math.max(0, route.ascentMeters - removedClimb) + stretch.ascentMeters;

  return {
    ...route,
    geometry: spliceGeometry(geometry, window, stretch.geometry),
    distanceMeters: route.distanceMeters * keptShare + stretch.distanceMeters,
    ascentMeters,
    durationSeconds:
      route.durationSeconds * keptShare + stretch.durationSeconds,
  };
}

/** What to ask the API for after an edit: the points of the short route, and what it replaces. */
export interface LocalEditPlan {
  window: EditWindow;
  points: LngLat[];
}

/** The vertex between `bounds.min` and `bounds.max` closest to `point`, and how far it is. */
function nearestInRange(
  geometry: readonly LngLat3[],
  point: LngLat,
  bounds: { min: number; max: number },
): { index: number; distanceMeters: number } {
  const cos = Math.cos((point[1] * Math.PI) / 180);
  let index = bounds.min;
  let best = Infinity;
  for (let i = bounds.min; i <= bounds.max; i++) {
    const dx = (geometry[i][0] - point[0]) * cos;
    const dy = geometry[i][1] - point[1];
    const squared = dx * dx + dy * dy;
    if (squared < best) {
      best = squared;
      index = i;
    }
  }
  return {
    index,
    distanceMeters: haversine(geometry[index], [point[0], point[1], 0]),
  };
}

/**
 * How to absorb `edit` into the route `geometry` it applies to, by recomputing only a stretch:
 * the window to replace and the points of the short route that replaces it (from the route before
 * the window, through the edited point, to the route after it). `null` when the edit has to be
 * computed in full: a start or an end removed, or fewer than two points left.
 */
export function planLocalEdit(
  geometry: readonly LngLat3[],
  edit: PointEdit,
): LocalEditPlan | null {
  const { previous, next } = edit;
  if (geometry.length < 2 || previous.length < 2 || next.length < 2) {
    return null;
  }
  const last = geometry.length - 1;
  const vertices = pointVertices(geometry, previous);
  const at = (vertex: number): LngLat => [
    geometry[vertex][0],
    geometry[vertex][1],
  ];

  if (edit.kind === 'insert') {
    if (edit.index < 1 || edit.index > previous.length - 1) return null;
    const bounds = {
      min: vertices[edit.index - 1],
      max: vertices[edit.index],
    };
    const { index, distanceMeters } = nearestInRange(
      geometry,
      edit.point,
      bounds,
    );
    const window = editWindow(geometry, index, distanceMeters, bounds);
    return { window, points: [at(window.from), edit.point, at(window.to)] };
  }

  const { index } = edit;
  if (index < 0 || index >= previous.length) return null;
  const isStart = index === 0;
  const isEnd = index === previous.length - 1;
  const bounds = {
    min: isStart ? 0 : vertices[index - 1],
    max: isEnd ? last : vertices[index + 1],
  };

  if (edit.kind === 'remove') {
    // The start or the end going away leaves no point to route through: compute in full.
    if (isStart || isEnd) return null;
    const window = editWindow(geometry, vertices[index], 0, bounds);
    return { window, points: [at(window.from), at(window.to)] };
  }

  if (previous.length !== next.length) return null;
  const offset = haversine(
    [edit.from[0], edit.from[1], 0],
    [edit.point[0], edit.point[1], 0],
  );
  const window = editWindow(geometry, vertices[index], offset, bounds);
  return {
    window,
    points: [
      ...(isStart ? [] : [at(window.from)]),
      edit.point,
      ...(isEnd ? [] : [at(window.to)]),
    ],
  };
}
