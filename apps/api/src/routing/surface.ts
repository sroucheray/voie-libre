/**
 * What a stretch of a route rides on, in five categories (see `docs/features/surface.md`). One character
 * per segment of the route's geometry:
 *
 * - `p` paved: a paved surface, or a road class with no surface told;
 * - `c` cycleway: `highway=cycleway`, unless its surface is unpaved;
 * - `u` unpaved or rough: an unpaved surface (cobbles included), or a track with no surface told;
 * - `s` path: a path, footway, bridleway or steps with no paved surface;
 * - `?` unknown.
 */
export type SurfaceCode = 'p' | 'c' | 'u' | 's' | '?';

export const SURFACE_CODES: readonly SurfaceCode[] = ['p', 'c', 'u', 's', '?'];

const PAVED_SURFACES = new Set([
  'asphalt',
  'concrete',
  'concrete:plates',
  'concrete:lanes',
  'paved',
  'paving_stones',
  'metal',
]);

const UNPAVED_SURFACES = new Set([
  'unpaved',
  'compacted',
  'fine_gravel',
  'gravel',
  'pebblestone',
  'dirt',
  'earth',
  'ground',
  'grass',
  'grass_paver',
  'mud',
  'sand',
  'woodchips',
  'rock',
  'clay',
  'snow',
  'ice',
  // Paved, but a rough ride: counted with the unpaved.
  'sett',
  'cobblestone',
  'unhewn_cobblestone',
]);

const ROAD_CLASSES = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'service',
  'living_street',
  'road',
  'pedestrian',
]);

const PATH_CLASSES = new Set(['path', 'footway', 'bridleway', 'steps']);

/** The category of a way from its OpenStreetMap tags (`k=v k=v`, as BRouter's `WayTags`). */
export function classifyWay(wayTags: string): SurfaceCode {
  const tags = new Map<string, string>();
  for (const pair of wayTags.split(' ')) {
    const at = pair.indexOf('=');
    if (at > 0) tags.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const highway = tags.get('highway') ?? '';
  const surface = tags.get('surface') ?? '';
  if (highway === 'cycleway') return UNPAVED_SURFACES.has(surface) ? 'u' : 'c';
  if (PAVED_SURFACES.has(surface)) return 'p';
  if (UNPAVED_SURFACES.has(surface)) return 'u';
  if (ROAD_CLASSES.has(highway)) return 'p';
  if (highway === 'track') return 'u';
  if (PATH_CLASSES.has(highway)) return 's';
  return '?';
}

const microdegrees = (degrees: number) => Math.round(degrees * 1e6);

/**
 * One character per segment of `geometry` from the `messages` of a BRouter answer: each message
 * is a way, given with the place where it ends. `undefined` when the messages do not line up with
 * the geometry (no messages, a place that is not on the route, a route that stops short).
 */
export function surfacesFromMessages(
  messages: unknown,
  geometry: readonly (readonly number[])[],
): string | undefined {
  if (!Array.isArray(messages) || messages.length < 2) return undefined;
  const header = messages[0] as string[];
  const tagsColumn = header.indexOf('WayTags');
  if (tagsColumn < 0 || header[0] !== 'Longitude') return undefined;

  // Where each place is on the route; a place passed twice is listed twice, in order.
  const places = new Map<string, number[]>();
  geometry.forEach(([lon, lat], i) => {
    const key = `${microdegrees(lon)},${microdegrees(lat)}`;
    const list = places.get(key);
    if (list) list.push(i);
    else places.set(key, [i]);
  });

  let codes = '';
  let at = 0;
  for (const row of messages.slice(1) as string[][]) {
    const end = places
      .get(`${Number(row[0])},${Number(row[1])}`)
      ?.find((i) => i >= at);
    if (end === undefined) return undefined;
    codes += classifyWay(row[tagsColumn] ?? '').repeat(end - at);
    at = end;
  }
  return at === geometry.length - 1 ? codes : undefined;
}
