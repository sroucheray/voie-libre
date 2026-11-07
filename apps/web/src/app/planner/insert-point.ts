import type { LngLat } from '../core/map/map-factory';
import type { LngLat3 } from './planner-map-driver';

/** Squared distance in a flat approximation, with longitude scaled by `cos`. */
function squaredDistance(
  a: readonly number[],
  b: readonly number[],
  cos: number,
) {
  const dx = (a[0] - b[0]) * cos;
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Index of the geometry vertex closest to `point`, looking from `from` on. */
function nearestVertex(
  geometry: readonly LngLat3[],
  point: readonly number[],
  from: number,
): number {
  const cos = Math.cos((point[1] * Math.PI) / 180);
  let best = from;
  let bestDistance = Infinity;
  for (let i = from; i < geometry.length; i++) {
    const d = squaredDistance(geometry[i], point, cos);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Where a waypoint added at `hit`, a place on the drawn route, belongs in the list of points: the
 * index it must take, between the start and the end. Each point is matched to a vertex of the
 * geometry going forward, so that a route which passes twice by a place still gets the right
 * segment. `null` when there is nothing to insert into.
 */
export function insertionIndex(
  geometry: readonly LngLat3[],
  points: readonly LngLat[],
  hit: LngLat,
): number | null {
  if (geometry.length < 2 || points.length < 2) return null;
  // The start is the first vertex and the end the last, whatever the snapping did to them.
  const vertices: number[] = [0];
  for (let i = 1; i < points.length - 1; i++) {
    vertices.push(nearestVertex(geometry, points[i], vertices[i - 1]));
  }
  vertices.push(geometry.length - 1);
  // The hit is a vertex too; on a tie, the earliest segment that contains it wins.
  const hitVertex = nearestVertex(geometry, hit, 0);
  for (let i = 1; i < vertices.length; i++) {
    if (hitVertex < vertices[i]) return i;
  }
  return points.length - 1;
}
