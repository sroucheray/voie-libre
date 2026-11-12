import type { LngLat } from '../core/map/map-factory';
import type { LngLat3 } from '../planner/planner-map-driver';

/** The most laps of a loop a file can hold. */
export const MAX_LAPS = 20;

/** A whole number of laps from 1 to {@link MAX_LAPS}; anything else becomes 1. */
export function clampLaps(value: unknown): number {
  const laps = Math.floor(Number(value));
  return Number.isFinite(laps) ? Math.min(MAX_LAPS, Math.max(1, laps)) : 1;
}

/** A route whose end is exactly on its start: the only kind that can be done several times. */
export function isLoopRoute(points: readonly LngLat[]): boolean {
  if (points.length < 2) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * The geometry of a loop done `laps` times in a row. The end of a lap is the start of the next, so
 * that place is written once.
 */
export function repeatGeometry(
  geometry: readonly LngLat3[],
  laps: number,
): LngLat3[] {
  const count = clampLaps(laps);
  const rest = geometry.slice(1);
  return [...geometry, ...Array.from({ length: count - 1 }, () => rest).flat()];
}

/** What `laps` laps of a route add up to. `ascentMeters` stays `null` when it is unknown. */
export function lapTotals(
  route: { distanceMeters: number; ascentMeters: number | null },
  laps: number,
): { distanceMeters: number; ascentMeters: number | null } {
  const count = clampLaps(laps);
  return {
    distanceMeters: route.distanceMeters * count,
    ascentMeters:
      route.ascentMeters === null ? null : route.ascentMeters * count,
  };
}
