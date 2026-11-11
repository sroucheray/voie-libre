import type { LngLat } from '../core/map/map-factory';
import { isLoopOf } from './planner-store';

/** A name for a route as a translation key under `saved.autoName` and its parameters. */
export interface AutoName {
  key: string;
  params: Record<string, string | number>;
}

/**
 * The name a route proposes for itself from where it goes, in the words of the UI language
 * (the keys are translated by the caller):
 *
 * - from one place to another: `A → B`; with one named stop `A → B via S`, with more `A → B via
 *   3 stops`;
 * - a loop: `Loop around A`;
 * - both ends in the same place: `Around A`.
 *
 * `null` when the place of an end is not known (offline, a lookup that failed, a route that was
 * opened or imported): the caller falls back on the profile and the length. The length and the
 * profile are not in the name: the list of saved routes shows them.
 *
 * @param shortOf the short name of a place, `null` when unknown
 */
export function autoRouteName(
  points: readonly LngLat[],
  shortOf: (point: LngLat) => string | null,
): AutoName | null {
  if (points.length < 2) return null;
  const from = shortOf(points[0]);
  if (!from) return null;
  if (isLoopOf(points))
    return { key: 'saved.autoName.loop', params: { place: from } };

  const to = shortOf(points[points.length - 1]);
  if (!to) return null;
  if (from === to)
    return { key: 'saved.autoName.within', params: { place: from } };

  const stops = points.slice(1, -1);
  if (stops.length > 1) {
    return {
      key: 'saved.autoName.tripStops',
      params: { from, to, count: stops.length },
    };
  }
  const via = stops.length === 1 ? shortOf(stops[0]) : null;
  return via
    ? { key: 'saved.autoName.tripVia', params: { from, to, via } }
    : { key: 'saved.autoName.trip', params: { from, to } };
}
