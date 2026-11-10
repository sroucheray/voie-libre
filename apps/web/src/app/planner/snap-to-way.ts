import type { LngLat } from '../core/map/map-factory';

/** A way of the basemap: a road, a track or a path, as the map tiles describe it. */
export interface Way {
  /** Class of the way in the Protomaps tiles: `major_road`, `minor_road`, `path`, `highway`... */
  kind: string;
  /** The OpenStreetMap value behind it: `residential`, `track`, `cycleway`, `footway`... */
  detail: string;
  line: readonly LngLat[];
}

/** A point snaps to a way no farther than this on the ground... */
export const SNAP_MAX_METERS = 100;
/** ... and no farther than this on screen, so that the point never jumps under the user's eyes. */
export const SNAP_MAX_PIXELS = 24;

/** Paths a road bike takes: the others are for feet or for wider tyres. */
const ROAD_PATHS: readonly string[] = [
  'cycleway',
  'driveway',
  'alley',
  'parking_aisle',
];
/** Paths a gravel bike takes on top of those. */
const GRAVEL_PATHS: readonly string[] = [
  ...ROAD_PATHS,
  'track',
  'path',
  'pedestrian',
  'bridleway',
];

/**
 * True when points placed on the map for `profile` must sit on a way. Running goes anywhere: a
 * point stays where it is placed.
 */
export function snapsToWays(profile: string): boolean {
  return profile === 'road' || profile === 'gravel';
}

/** True when `profile` can ride on `way`. Motorways, rails and footways never count. */
export function usableBy(profile: string, way: Way): boolean {
  if (!snapsToWays(profile)) return false;
  switch (way.kind) {
    case 'major_road':
    case 'minor_road':
      return true;
    case 'other':
      return way.detail === 'living_street';
    case 'path':
      return (profile === 'gravel' ? GRAVEL_PATHS : ROAD_PATHS).includes(
        way.detail,
      );
    default:
      return false;
  }
}

/**
 * The place on the ways `profile` can use that is closest to `point`, when it is within
 * `maxMeters`; `null` when no such way is that close.
 */
export function snapToWay(
  point: LngLat,
  ways: readonly Way[],
  profile: string,
  maxMeters: number = SNAP_MAX_METERS,
): LngLat | null {
  // Meters per degree around the point: flat enough over a few hundred meters.
  const perLat = 111_320;
  const perLon = perLat * Math.cos((point[1] * Math.PI) / 180);
  let best: LngLat | null = null;
  let bestSquared = maxMeters * maxMeters;
  for (const way of ways) {
    if (!usableBy(profile, way)) continue;
    const { line } = way;
    for (let i = 0; i < line.length; i++) {
      // The point as the origin; a way of one vertex is that vertex.
      const ax = (line[i][0] - point[0]) * perLon;
      const ay = (line[i][1] - point[1]) * perLat;
      const next = line[Math.min(i + 1, line.length - 1)];
      const dx = (next[0] - point[0]) * perLon - ax;
      const dy = (next[1] - point[1]) * perLat - ay;
      const length = dx * dx + dy * dy;
      const t =
        length === 0
          ? 0
          : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
      const x = ax + t * dx;
      const y = ay + t * dy;
      const squared = x * x + y * y;
      if (squared <= bestSquared) {
        bestSquared = squared;
        best = [point[0] + x / perLon, point[1] + y / perLat];
      }
    }
  }
  return best;
}
