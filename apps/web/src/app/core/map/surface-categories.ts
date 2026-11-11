/**
 * What a stretch of a route rides on (see `PlannedRoute.surfaces`): paved, cycleway, unpaved or
 * rough, path, unknown.
 */
import { PALETTE } from './palette';

export type SurfaceCode = 'p' | 'c' | 'u' | 's' | '?';

/** In the order of the legends. */
export const SURFACE_CODES: readonly SurfaceCode[] = ['p', 'c', 'u', 's', '?'];

/** Colours of the bar under the chart, of the route on the map and of their legends. */
export const SURFACE_COLORS: Record<SurfaceCode, string> = {
  p: PALETTE.surface.p,
  c: PALETTE.surface.c,
  u: PALETTE.surface.u,
  s: PALETTE.surface.s,
  '?': PALETTE.surface.unknown,
};

/** Translation key of the name of a category. */
export const surfaceKey = (code: SurfaceCode) =>
  `surface.${code === '?' ? 'unknown' : code}`;
