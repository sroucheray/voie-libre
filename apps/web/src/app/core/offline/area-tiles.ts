import type { LngLat } from '../map/map-factory';

/** A tile of the Web Mercator pyramid. */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** `[west, south, east, north]` in degrees. */
export type Box = [number, number, number, number];

/** The deepest zoom of the basemap archive: deeper zooms are drawn from it. */
export const OFFLINE_MAX_ZOOM = 14;

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAX_LATITUDE = 85.05112878;

/** Column and row of the tile of zoom `z` that holds a place (clamped to the pyramid). */
export function tileOf(lon: number, lat: number, z: number): TileId {
  const n = 2 ** z;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const radians = (clamped * Math.PI) / 180;
  const column = ((lon + 180) / 360) * n;
  const row =
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
    n;
  const clamp = (value: number) =>
    Math.max(0, Math.min(n - 1, Math.floor(value)));
  return { z, x: clamp(column), y: clamp(row) };
}

/** How many tiles a box has from zoom `minZoom` to `maxZoom`, without listing them. */
export function countBoxTiles(
  box: Box,
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const northWest = tileOf(box[0], box[3], z);
    const southEast = tileOf(box[2], box[1], z);
    total += (southEast.x - northWest.x + 1) * (southEast.y - northWest.y + 1);
  }
  return total;
}

/** Every tile of a box from zoom `minZoom` to `maxZoom`. */
export function boxTiles(box: Box, minZoom: number, maxZoom: number): TileId[] {
  const tiles: TileId[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const northWest = tileOf(box[0], box[3], z);
    const southEast = tileOf(box[2], box[1], z);
    for (let x = northWest.x; x <= southEast.x; x++) {
      for (let y = northWest.y; y <= southEast.y; y++) tiles.push({ z, x, y });
    }
  }
  return tiles;
}

/** The box that holds a polyline, grown by `marginMeters` on every side. */
export function boxAround(line: readonly LngLat[], marginMeters = 0): Box {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of line) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const dLat = (marginMeters / EARTH_CIRCUMFERENCE_METERS) * 360;
  const dLon =
    dLat / Math.max(0.01, Math.cos((((south + north) / 2) * Math.PI) / 180));
  return [west - dLon, south - dLat, east + dLon, north + dLat];
}

/** Meters between two places, flat-earth: good over the few hundred meters of one step. */
function metersBetween(a: LngLat, b: LngLat): number {
  const dLat = ((b[1] - a[1]) * EARTH_CIRCUMFERENCE_METERS) / 360;
  const dLon =
    ((b[0] - a[0]) *
      EARTH_CIRCUMFERENCE_METERS *
      Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)) /
    360;
  return Math.hypot(dLat, dLon);
}

/**
 * The tiles within `bufferMeters` of a polyline, from zoom `minZoom` to `maxZoom`: the corridor of
 * a route. The line is walked in steps of half the width of a tile, and each step adds the tiles
 * of the box that holds its buffer, so no tile touching the buffer is missed.
 */
export function corridorTiles(
  line: readonly LngLat[],
  bufferMeters: number,
  minZoom: number,
  maxZoom: number,
): TileId[] {
  if (line.length === 0) return [];
  const tiles: TileId[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const seen = new Set<number>();
    const n = 2 ** z;
    const add = (point: LngLat) => {
      const [west, south, east, north] = boxAround([point], bufferMeters);
      const northWest = tileOf(west, north, z);
      const southEast = tileOf(east, south, z);
      for (let x = northWest.x; x <= southEast.x; x++) {
        for (let y = northWest.y; y <= southEast.y; y++) {
          const key = x * n + y;
          if (!seen.has(key)) {
            seen.add(key);
            tiles.push({ z, x, y });
          }
        }
      }
    };
    // Half a tile at the equator: finer than the tiles anywhere else on Earth.
    const step = Math.max(50, EARTH_CIRCUMFERENCE_METERS / n / 2);
    add(line[0]);
    for (let i = 1; i < line.length; i++) {
      const from = line[i - 1];
      const to = line[i];
      const parts = Math.max(1, Math.ceil(metersBetween(from, to) / step));
      for (let part = 1; part <= parts; part++) {
        const t = part / parts;
        add([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      }
    }
  }
  return tiles;
}

/**
 * The box a map shows: `center` and `zoom` of a MapLibre map (512 px tiles) over a view of
 * `width` by `height` pixels.
 */
export function viewBox(
  center: LngLat,
  zoom: number,
  width: number,
  height: number,
): Box {
  const world = 512 * 2 ** zoom;
  const lonSpan = (width / world) * 360;
  const mercatorY = (lat: number) => {
    const radians =
      (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / 180;
    return (
      0.5 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / (2 * Math.PI)
    );
  };
  const latOf = (y: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  const y = mercatorY(center[1]);
  const halfY = height / 2 / world;
  return [
    center[0] - lonSpan / 2,
    latOf(Math.min(1, y + halfY)),
    center[0] + lonSpan / 2,
    latOf(Math.max(0, y - halfY)),
  ];
}
