import { haversine } from '../planner/elevation-profile';
import type { LngLat3 } from '../planner/planner-map-driver';
import type { Profile } from '../planner/planner-store';

/** Largest file read, in characters: a day of 1 Hz GPS is about 3 MB. */
export const MAX_GPX_CHARACTERS = 10_000_000;
/** More points than the API accepts for sharing are thinned out (see `SHARE_*` limits). */
export const MAX_IMPORTED_POINTS = 5000;
/** Waypoints of the planner: the API accepts 20 points. */
const MAX_ROUTE_POINTS = 20;
/** Elevation changes smaller than this are noise, not climbing. */
const CLIMB_THRESHOLD_METERS = 3;
/** Typical average speed in km/h, to estimate a duration the file does not give. */
const SPEED_KMH: Record<Profile, number> = { road: 22, gravel: 17, trail: 8 };

export type GpxImportErrorCode =
  'too_large' | 'invalid_file' | 'no_track' | 'too_short';

export class GpxImportError extends Error {
  constructor(readonly code: GpxImportErrorCode) {
    super(code);
  }
}

/** What an imported file gives, ready to be saved as a route. */
export interface ImportedRoute {
  /** The name found in the file, if any. */
  name: string | null;
  points: [number, number][];
  geometry: LngLat3[];
  distanceMeters: number;
  /** `null` when the file has no elevation: the geometry then carries zeros. */
  ascentMeters: number | null;
  durationSeconds: number;
  /** True when some points were dropped to stay within {@link MAX_IMPORTED_POINTS}. */
  thinned: boolean;
}

interface RawPoint {
  lon: number;
  lat: number;
  ele: number | null;
}

function readPoints(elements: Element[]): RawPoint[] {
  const points: RawPoint[] = [];
  for (const element of elements) {
    const lat = Number(element.getAttribute('lat'));
    const lon = Number(element.getAttribute('lon'));
    if (
      !element.getAttribute('lat') ||
      !element.getAttribute('lon') ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      continue;
    }
    const text = Array.from(element.children).find(
      (child) => child.localName === 'ele',
    )?.textContent;
    const ele = text === undefined || text.trim() === '' ? NaN : Number(text);
    points.push({ lon, lat, ele: Number.isFinite(ele) ? ele : null });
  }
  return points;
}

/** Matches by local name in any namespace. `querySelectorAll` is far faster than live collections. */
const children = (parent: Element | Document, name: string): Element[] =>
  Array.from(parent.querySelectorAll(name));

/** Sum of the climbs, ignoring wobbles smaller than {@link CLIMB_THRESHOLD_METERS}. */
export function climbOf(elevations: readonly number[]): number {
  if (elevations.length === 0) return 0;
  let reference = elevations[0];
  let ascent = 0;
  for (const value of elevations) {
    if (value - reference >= CLIMB_THRESHOLD_METERS) {
      ascent += value - reference;
      reference = value;
    } else if (reference - value >= CLIMB_THRESHOLD_METERS) {
      reference = value;
    }
  }
  return ascent;
}

/** Keeps `max` points spread along the line, always the first and the last. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const result: T[] = [];
  for (let i = 0; i < max; i++) {
    result.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  }
  return result;
}

/**
 * Reads a GPX file: the first track (all its segments joined), or when the file has none the
 * first route (`<rte>`). Everything stays on the device. Throws {@link GpxImportError}.
 */
export function parseGpx(text: string, profile: Profile): ImportedRoute {
  if (text.length > MAX_GPX_CHARACTERS) throw new GpxImportError('too_large');

  const document = new DOMParser().parseFromString(text, 'application/xml');
  const root = document.documentElement;
  if (
    !root ||
    root.localName !== 'gpx' ||
    document.getElementsByTagName('parsererror').length > 0
  ) {
    throw new GpxImportError('invalid_file');
  }

  const track = children(document, 'trk')[0];
  const route = children(document, 'rte')[0];
  const source = track ?? route;
  if (!source) throw new GpxImportError('no_track');

  const raw = readPoints(children(source, track ? 'trkpt' : 'rtept'));
  if (raw.length === 0) throw new GpxImportError('no_track');
  if (raw.length < 2) throw new GpxImportError('too_short');

  const elevationKnown = raw.every((point) => point.ele !== null);
  const kept = thin(raw, MAX_IMPORTED_POINTS);
  const geometry: LngLat3[] = kept.map((p) => [p.lon, p.lat, p.ele ?? 0]);

  let distanceMeters = 0;
  for (let i = 1; i < geometry.length; i++) {
    distanceMeters += haversine(geometry[i - 1], geometry[i]);
  }
  if (distanceMeters <= 0) throw new GpxImportError('too_short');

  // A route's own points (<rtept>) are its via points; a track only gives its two ends.
  const ends: [number, number][] = [
    [geometry[0][0], geometry[0][1]],
    [geometry[geometry.length - 1][0], geometry[geometry.length - 1][1]],
  ];
  const points =
    !track && raw.length <= MAX_ROUTE_POINTS
      ? raw.map((p): [number, number] => [p.lon, p.lat])
      : ends;

  const name = children(source, 'name')[0]?.textContent?.trim() || null;

  return {
    name,
    points,
    geometry,
    distanceMeters,
    ascentMeters: elevationKnown ? climbOf(geometry.map((p) => p[2])) : null,
    durationSeconds: (distanceMeters / 1000 / SPEED_KMH[profile]) * 3600,
    thinned: kept.length < raw.length,
  };
}
