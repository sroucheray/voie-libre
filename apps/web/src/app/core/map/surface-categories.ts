/**
 * What a stretch of a route rides on (see `PlannedRoute.surfaces`): paved, cycleway, unpaved or
 * rough, path, unknown.
 */
export type SurfaceCode = 'p' | 'c' | 'u' | 's' | '?';

/** In the order of the legends. */
export const SURFACE_CODES: readonly SurfaceCode[] = ['p', 'c', 'u', 's', '?'];

/** Colours of the bar under the chart, of the route on the map and of their legends. */
export const SURFACE_COLORS: Record<SurfaceCode, string> = {
  p: '#667085',
  c: '#12b76a',
  u: '#f79009',
  s: '#93370d',
  '?': '#d0d5dd',
};

/** Translation key of the name of a category. */
export const surfaceKey = (code: SurfaceCode) =>
  `surface.${code === '?' ? 'unknown' : code}`;
