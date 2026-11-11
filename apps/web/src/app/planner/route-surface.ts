import type { ElevationProfile } from './elevation-profile';

import {
  SURFACE_CODES,
  type SurfaceCode,
} from '../core/map/surface-categories';

export {
  SURFACE_CODES,
  SURFACE_COLORS,
  surfaceKey,
  type SurfaceCode,
} from '../core/map/surface-categories';

/** A character the app does not know counts as unknown. */
const codeOf = (character: string): SurfaceCode =>
  (SURFACE_CODES as readonly string[]).includes(character)
    ? (character as SurfaceCode)
    : '?';

/** Consecutive segments of one category, as the indexes of the geometry vertices they join. */
export interface SurfaceRun {
  code: SurfaceCode;
  from: number;
  to: number;
}

/** The codes cut into runs; a run ends on the vertex the next one starts at. */
export function surfaceRuns(surfaces: string): SurfaceRun[] {
  const runs: SurfaceRun[] = [];
  for (let i = 0; i < surfaces.length; i++) {
    const code = codeOf(surfaces[i]);
    const last = runs[runs.length - 1];
    if (last && last.code === code) last.to = i + 1;
    else runs.push({ code, from: i, to: i + 1 });
  }
  return runs;
}

/** How much of the route is of one category. */
export interface SurfaceShare {
  code: SurfaceCode;
  meters: number;
  /** Fraction of the route, from 0 to 1. */
  share: number;
}

/**
 * The share of each category along `profile`, in the order of {@link SURFACE_CODES}, the ones the
 * route does not ride on left out. Empty when the codes do not fit the profile.
 */
export function surfaceShares(
  profile: ElevationProfile,
  surfaces: string,
): SurfaceShare[] {
  if (surfaces.length !== profile.samples.length - 1) return [];
  const meters = new Map<SurfaceCode, number>();
  for (const run of surfaceRuns(surfaces)) {
    const length =
      profile.samples[run.to].distance - profile.samples[run.from].distance;
    meters.set(run.code, (meters.get(run.code) ?? 0) + length);
  }
  return SURFACE_CODES.filter((code) => (meters.get(code) ?? 0) > 0).map(
    (code) => ({
      code,
      meters: meters.get(code) ?? 0,
      share: (meters.get(code) ?? 0) / profile.totalDistance,
    }),
  );
}
