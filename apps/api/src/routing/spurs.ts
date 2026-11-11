import { distance } from './loops';
import type { RouteResult } from './routing-provider';

/** Coordinates closer than this (1e-5 degree, about 1 m) are the same spot on the road. */
const KEY_PRECISION = 1e5;
/** A route that is mostly out and back is not a loop with a spur: leave it alone. */
const MAX_TRIMMED_RATIO = 0.3;

type Point = readonly [number, number, number];

const key = (p: readonly number[]) =>
  `${Math.round(p[0] * KEY_PRECISION)},${Math.round(p[1] * KEY_PRECISION)}`;

const length = (geometry: readonly Point[]) => {
  let total = 0;
  for (let i = 1; i < geometry.length; i++) {
    total += distance(geometry[i - 1], geometry[i]);
  }
  return total;
};

/**
 * Share of the route (0 to 1) driven over a stretch of road that is also driven the other way:
 * spurs, but also the stem of a lollipop. A clean loop is 0, a pure out and back is 1.
 */
export function retracedRatio(geometry: readonly Point[]): number {
  const edges = new Set<string>();
  for (let i = 1; i < geometry.length; i++) {
    edges.add(`${key(geometry[i - 1])}>${key(geometry[i])}`);
  }
  let total = 0;
  let retraced = 0;
  for (let i = 1; i < geometry.length; i++) {
    const from = key(geometry[i - 1]);
    const to = key(geometry[i]);
    if (from === to) continue;
    const meters = distance(geometry[i - 1], geometry[i]);
    total += meters;
    if (edges.has(`${to}>${from}`)) retraced += meters;
  }
  return total > 0 ? retraced / total : 0;
}

/**
 * Cuts the spurs out of a route: where it turns round and comes back over the very same road, the
 * out and back is dropped and the route goes on from where the spur began. Distance, climb and
 * duration follow (climb from the dropped points, duration in proportion to the distance).
 * Returns the route untouched when nothing was cut, or when the cut would be more than
 * {@link MAX_TRIMMED_RATIO} of it.
 */
export function trimSpurs(route: RouteResult): RouteResult {
  const kept: [number, number, number][] = [];
  // One code per segment kept, in step with `kept`.
  const keptSurfaces: string[] = [];
  route.geometry.forEach((point, i) => {
    const back = kept.length >= 2 ? kept[kept.length - 2] : null;
    if (back && key(back) === key(point)) {
      // Back on the point before the last one: the last stretch was a spur.
      kept.pop();
      keptSurfaces.pop();
    } else {
      if (kept.length > 0) keptSurfaces.push(route.surfaces?.[i - 1] ?? '?');
      kept.push(point as [number, number, number]);
    }
  });
  if (kept.length === route.geometry.length || kept.length < 2) return route;

  const before = length(route.geometry);
  const after = length(kept);
  const removed = before - after;
  if (before <= 0 || removed / before > MAX_TRIMMED_RATIO) return route;

  const climb = (geometry: readonly Point[]) => {
    let total = 0;
    for (let i = 1; i < geometry.length; i++) {
      total += Math.max(0, geometry[i][2] - geometry[i - 1][2]);
    }
    return total;
  };
  const ratio = after / before;
  return {
    geometry: kept,
    distanceMeters: route.distanceMeters * ratio,
    ascentMeters: Math.max(
      0,
      route.ascentMeters - (climb(route.geometry) - climb(kept)),
    ),
    durationSeconds: route.durationSeconds * ratio,
    ...(route.surfaces === undefined
      ? {}
      : { surfaces: keptSurfaces.join('') }),
  };
}
