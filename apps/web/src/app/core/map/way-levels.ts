import type { LayerSpecification } from 'maplibre-gl';

/** How well a way suits a profile. Ways of no level are drawn as the basemap draws them. */
export type WayLevel = 'good' | 'fair' | 'avoid';

/** Drawn from the bottom up: the ideal ways end up on top. */
export const WAY_LEVELS: readonly WayLevel[] = ['avoid', 'fair', 'good'];

export const WAY_COLORS: Record<WayLevel, string> = {
  good: '#12b76a',
  fair: '#f79009',
  avoid: '#d92d20',
};

/** The OpenStreetMap value of a way (`kind_detail` in the Protomaps `roads` layer), with links. */
const links = (...values: string[]) => values.flatMap((v) => [v, `${v}_link`]);

const SMALL_ROADS = ['residential', 'service', 'unclassified'];
const FAST = links('motorway', 'trunk');

/** Levels by profile and by way, from the classes the basemap tiles carry (no surface, no grade). */
const LEVELS: Record<string, Record<WayLevel, readonly string[]>> = {
  road: {
    good: ['cycleway', ...SMALL_ROADS, ...links('tertiary')],
    fair: [...links('primary', 'secondary'), 'living_street'],
    avoid: FAST,
  },
  gravel: {
    good: ['track', 'path', 'bridleway', 'cycleway', ...SMALL_ROADS],
    fair: [...links('tertiary', 'secondary'), 'pedestrian', 'living_street'],
    avoid: [...FAST, ...links('primary')],
  },
  trail: {
    good: ['path', 'footway', 'track', 'bridleway', 'pedestrian'],
    fair: [...SMALL_ROADS, 'living_street', 'cycleway', ...links('tertiary')],
    avoid: [...FAST, ...links('primary', 'secondary')],
  },
};

/** The level of a way for `profile`, `null` when the way does not matter for it. */
export function wayLevel(profile: string, detail: string): WayLevel | null {
  const levels = LEVELS[profile];
  if (!levels) return null;
  return WAY_LEVELS.find((level) => levels[level].includes(detail)) ?? null;
}

/** Id of the layer that draws the ways of `level`. */
export const wayLayerId = (level: WayLevel) => `ways-${level}`;

/**
 * One line layer per level, over the basemap's `roads` layer; none for a profile without levels.
 * The ways to avoid are dashed, so that colour is not the only signal.
 */
export function wayLayers(
  source: string,
  profile: string,
): LayerSpecification[] {
  const levels = LEVELS[profile];
  if (!levels) return [];
  return WAY_LEVELS.map((level) => ({
    id: wayLayerId(level),
    type: 'line',
    source,
    'source-layer': 'roads',
    filter: ['in', ['get', 'kind_detail'], ['literal', [...levels[level]]]],
    layout: { 'line-cap': level === 'avoid' ? 'butt' : 'round' },
    paint: {
      'line-color': WAY_COLORS[level],
      'line-opacity': 0.85,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        1,
        14,
        2.5,
        18,
        6,
      ],
      ...(level === 'avoid' ? { 'line-dasharray': [2, 2] } : {}),
    },
  }));
}
