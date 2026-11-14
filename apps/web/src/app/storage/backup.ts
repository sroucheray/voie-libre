import {
  LOOP_ASCENT_MAX_METERS,
  LOOP_DIRECTIONS,
  LOOP_DISTANCE_MAX_METERS,
  LOOP_DISTANCE_MIN_METERS,
  MAX_POINTS,
  PROFILES,
  type LoopMode,
} from '../planner/planner-store';
import type { NewSavedRoute, SavedRoute } from './saved-route';

/** What the file says about itself, so that another file is recognised and refused. */
export const BACKUP_KIND = 'voie-libre-routes';
/** The version of the file format; a newer file is refused with a message to update the app. */
export const BACKUP_VERSION = 1;
/** A file larger than this is not read (a route is some tens of kilobytes). */
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
/** More routes than this in a file is taken for a damaged or foreign file. */
export const BACKUP_MAX_ROUTES = 1000;
const MAX_GEOMETRY_POINTS = 50_000;
const MAX_NAME_LENGTH = 200;

/** A route as the file holds it: what is needed to show and export it, nothing private. */
export type BackupRoute = NewSavedRoute & { laps?: number };

export type BackupErrorCode =
  'not_a_backup' | 'newer_version' | 'invalid' | 'too_large';

/** Thrown by the import; the UI translates the code under `backup.errors.*`. */
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(`Backup failed: ${code}`);
    this.name = 'BackupError';
  }
}

export type BackupResult =
  { ok: true; routes: BackupRoute[] } | { ok: false; code: BackupErrorCode };

/** The file name of a backup made at `date`, for example `voie-libre-routes-2026-11-14.json`. */
export function backupFileName(date: Date): string {
  return `voie-libre-routes-${date.toISOString().slice(0, 10)}.json`;
}

/**
 * The text of a backup file holding these routes. Ids, dates and the delete token of a route
 * shared by the server never leave the device: they are not written.
 */
export function buildBackup(
  routes: readonly SavedRoute[],
  exportedAt: Date,
): string {
  return JSON.stringify({
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    routes: routes.map((r): BackupRoute => ({
      name: r.name,
      profile: r.profile,
      points: r.points,
      geometry: r.geometry,
      distanceMeters: r.distanceMeters,
      ascentMeters: r.ascentMeters,
      durationSeconds: r.durationSeconds,
      ...(r.elevationSource ? { elevationSource: r.elevationSource } : {}),
      ...(r.surfaces === undefined ? {} : { surfaces: r.surfaces }),
      ...(r.loop ? { loop: r.loop } : {}),
      ...(r.laps && r.laps > 1 ? { laps: r.laps } : {}),
    })),
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const inRange = (value: unknown, min: number, max: number): value is number =>
  finite(value) && value >= min && value <= max;

function isLoopMode(value: unknown): value is LoopMode {
  if (!isRecord(value)) return false;
  if (value['mode'] === 'avoid_outbound') return true;
  return (
    value['mode'] === 'distance' &&
    inRange(
      value['distanceMeters'],
      LOOP_DISTANCE_MIN_METERS,
      LOOP_DISTANCE_MAX_METERS,
    ) &&
    (value['ascentMeters'] === undefined ||
      inRange(value['ascentMeters'], 0, LOOP_ASCENT_MAX_METERS)) &&
    (value['direction'] === undefined ||
      (LOOP_DIRECTIONS as readonly unknown[]).includes(value['direction']))
  );
}

/** A route read from a file, or null when anything in it is out of shape. */
function readRoute(value: unknown): BackupRoute | null {
  if (!isRecord(value)) return null;
  const { name, profile, points, geometry } = value;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    !(PROFILES as readonly unknown[]).includes(profile) ||
    !Array.isArray(points) ||
    points.length < 2 ||
    points.length > MAX_POINTS ||
    !points.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        inRange(p[0], -180, 180) &&
        inRange(p[1], -90, 90),
    ) ||
    !Array.isArray(geometry) ||
    geometry.length < 2 ||
    geometry.length > MAX_GEOMETRY_POINTS ||
    !geometry.every(
      (g) =>
        Array.isArray(g) &&
        g.length === 3 &&
        inRange(g[0], -180, 180) &&
        inRange(g[1], -90, 90) &&
        finite(g[2]),
    ) ||
    !inRange(value['distanceMeters'], 0, 1e8) ||
    !inRange(value['durationSeconds'], 0, 1e9) ||
    !(value['ascentMeters'] === null || inRange(value['ascentMeters'], 0, 1e6))
  ) {
    return null;
  }
  const surfaces = value['surfaces'];
  if (
    surfaces !== undefined &&
    (typeof surfaces !== 'string' ||
      surfaces.length !== geometry.length - 1 ||
      !/^[pcus?]*$/.test(surfaces))
  ) {
    return null;
  }
  const source = value['elevationSource'];
  if (source !== undefined && source !== 'copernicus' && source !== 'srtm') {
    return null;
  }
  const loop = value['loop'];
  if (loop !== undefined && !isLoopMode(loop)) return null;
  const laps = value['laps'];
  if (laps !== undefined && !(Number.isInteger(laps) && inRange(laps, 2, 20))) {
    return null;
  }
  return {
    name,
    profile: profile as BackupRoute['profile'],
    points: (points as number[][]).map((p) => [p[0], p[1]]),
    geometry: geometry as [number, number, number][],
    distanceMeters: value['distanceMeters'] as number,
    ascentMeters: value['ascentMeters'] as number | null,
    durationSeconds: value['durationSeconds'] as number,
    ...(source ? { elevationSource: source } : {}),
    ...(surfaces === undefined ? {} : { surfaces }),
    ...(loop ? { loop } : {}),
    ...(laps ? { laps: laps as number } : {}),
  };
}

/**
 * Reads the text of a backup file. Nothing in a file is trusted: one route out of shape refuses
 * the whole file, so that a damaged file never half-imports.
 */
export function parseBackup(text: string): BackupResult {
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, code: 'too_large' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: 'not_a_backup' };
  }
  if (!isRecord(data) || data['kind'] !== BACKUP_KIND) {
    return { ok: false, code: 'not_a_backup' };
  }
  const version = data['version'];
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, code: 'invalid' };
  }
  if ((version as number) > BACKUP_VERSION) {
    return { ok: false, code: 'newer_version' };
  }
  const list = data['routes'];
  if (!Array.isArray(list) || list.length > BACKUP_MAX_ROUTES) {
    return { ok: false, code: 'invalid' };
  }
  const routes: BackupRoute[] = [];
  for (const item of list) {
    const route = readRoute(item);
    if (!route) return { ok: false, code: 'invalid' };
    routes.push(route);
  }
  return { ok: true, routes };
}

/** What makes two routes the same one, to skip a route already on the device when importing. */
export function backupKey(
  route: Pick<BackupRoute, 'name' | 'profile' | 'points' | 'distanceMeters'>,
): string {
  return JSON.stringify([
    route.name,
    route.profile,
    route.points.map((p) => [p[0], p[1]]),
    Math.round(route.distanceMeters),
  ]);
}
