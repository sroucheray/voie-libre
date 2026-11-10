/**
 * Elevation tiles for the map's hillshade: the numbers shared by the script that builds them
 * (`scripts/build-relief-tiles.ts`) and the map style that reads them.
 */

/** File name of the archive of elevation tiles, beside the basemap's. */
export const RELIEF_TILES_FILE = 'relief.pmtiles';
/** Pixels on each side of a tile. */
export const RELIEF_TILE_SIZE = 512;
/** Below this zoom the relief of a region is a few pixels: no tile. */
export const RELIEF_MIN_ZOOM = 6;
/**
 * The deepest zoom built: a pixel is about 27 m at latitude 45, the 30 m of Copernicus GLO-30.
 * The map stretches these tiles at closer zooms.
 */
export const RELIEF_MAX_ZOOM = 11;
/** Elevations are rounded to this: finer than the data is exact, and it compresses well. */
export const RELIEF_STEP_METERS = 0.25;

/** `[west, south, east, north]` in degrees. */
export type BoundingBox = readonly [number, number, number, number];

/** Tile column (fractional) of a longitude at `zoom`. */
function columnOf(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

/** Tile row (fractional) of a latitude at `zoom`, in the Web Mercator projection. */
function rowOf(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    2 ** zoom
  );
}

/** The tiles of `zoom` that touch `bbox`, as inclusive ranges of columns and rows. */
export function tileRange(
  bbox: BoundingBox,
  zoom: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const last = 2 ** zoom - 1;
  const clamp = (value: number) => Math.max(0, Math.min(last, value));
  const [west, south, east, north] = bbox;
  return {
    minX: clamp(Math.floor(columnOf(west, zoom))),
    // A box that ends exactly on a tile edge does not need the next tile.
    maxX: clamp(Math.ceil(columnOf(east, zoom)) - 1),
    minY: clamp(Math.floor(rowOf(north, zoom))),
    maxY: clamp(Math.ceil(rowOf(south, zoom)) - 1),
  };
}

/**
 * Longitude and latitude of a place in tile `x`, `y` of `zoom`: `px` and `py` count pixels from
 * the tile's top left corner and may be fractions (0.5 is the centre of the first pixel).
 */
export function tilePixelToLngLat(
  x: number,
  y: number,
  zoom: number,
  px: number,
  py: number,
  size: number = RELIEF_TILE_SIZE,
): [number, number] {
  const n = 2 ** zoom;
  const lon = ((x + px / size) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / size)) / n))) * 180) /
    Math.PI;
  return [lon, lat];
}

/**
 * An elevation as the red, green and blue of the "terrarium" encoding, which MapLibre decodes as
 * `red × 256 + green + blue / 256 − 32768`. The elevation is rounded to
 * {@link RELIEF_STEP_METERS} first.
 */
export function toTerrarium(meters: number): [number, number, number] {
  const rounded = Math.round(meters / RELIEF_STEP_METERS) * RELIEF_STEP_METERS;
  const value = Math.max(0, Math.min(65535.99, rounded + 32768));
  const whole = Math.floor(value);
  return [whole >> 8, whole & 0xff, Math.floor((value - whole) * 256)];
}

/** The elevation a terrarium pixel stands for. */
export function fromTerrarium(
  red: number,
  green: number,
  blue: number,
): number {
  return red * 256 + green + blue / 256 - 32768;
}
