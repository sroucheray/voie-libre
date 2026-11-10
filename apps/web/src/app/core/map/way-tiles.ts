import { InjectionToken, inject } from '@angular/core';
import { basemapTilesUrl } from './basemap-style';
import { BASEMAP_URL, basemapTileReader, type LngLat } from './map-factory';

/** A way of the basemap: a road, a track or a path, as the map tiles describe it. */
export interface Way {
  /** Class of the way in the Protomaps tiles: `major_road`, `minor_road`, `path`, `highway`... */
  kind: string;
  /** The OpenStreetMap value behind it: `residential`, `track`, `cycleway`, `footway`... */
  detail: string;
  line: readonly LngLat[];
}

/**
 * The zoom whose tiles hold every way, down to paths: the deepest of the basemap extract (see
 * `scripts/download-basemap.sh`). Tiles of lower zooms leave the small roads out.
 */
export const WAY_TILE_ZOOM = 14;

/** Layer of the Protomaps tiles that holds roads, tracks, paths and rails. */
const ROADS_LAYER = 'roads';
const LINE = 2;

/** The ways of tile `x`, `y` at {@link WAY_TILE_ZOOM}; `null` when the basemap has no such tile. */
export type WayTileReader = (x: number, y: number) => Promise<Way[] | null>;

/** The tile of zoom `zoom` that holds `point`. */
export function tileAt(
  point: LngLat,
  zoom: number = WAY_TILE_ZOOM,
): { x: number; y: number } {
  const n = 2 ** zoom;
  const lat = (point[1] * Math.PI) / 180;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
  return {
    x: clamp(((point[0] + 180) / 360) * n),
    y: clamp(
      ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
    ),
  };
}

/** Longitude and latitude of a position inside tile `x`, `y` (`px`, `py` from 0 to 1). */
function fromTile(
  x: number,
  y: number,
  px: number,
  py: number,
  zoom: number,
): LngLat {
  const n = 2 ** zoom;
  const lon = ((x + px) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py)) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** The ways of a vector tile of the basemap, in longitude and latitude. */
export async function decodeWays(
  bytes: Uint8Array,
  x: number,
  y: number,
  zoom: number = WAY_TILE_ZOOM,
): Promise<Way[]> {
  // Loaded on demand, like the map: only a click on the map needs them.
  const [{ VectorTile }, { PbfReader }] = await Promise.all([
    import('@mapbox/vector-tile'),
    import('pbf'),
  ]);
  const layer = new VectorTile(new PbfReader(bytes)).layers[ROADS_LAYER];
  if (!layer) return [];
  const ways: Way[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== LINE) continue;
    const kind = String(feature.properties['kind'] ?? '');
    const detail = String(feature.properties['kind_detail'] ?? '');
    for (const line of feature.loadGeometry()) {
      ways.push({
        kind,
        detail,
        line: line.map((p) =>
          fromTile(x, y, p.x / layer.extent, p.y / layer.extent, zoom),
        ),
      });
    }
  }
  return ways;
}

/**
 * Gives the reader of the basemap's ways, or `null` when there is none (no map yet): points are
 * then left where they are placed. The real one reads the tiles the map reads (the offline copy
 * first), so it calls no other server and works without a network once the basemap is downloaded.
 */
export const WAY_TILES = new InjectionToken<() => WayTileReader | null>(
  'WAY_TILES',
  {
    providedIn: 'root',
    factory: () => {
      const archive = basemapTilesUrl(inject(BASEMAP_URL));
      return () => {
        const read = basemapTileReader();
        if (!read) return null;
        return async (x, y) => {
          const bytes = await read(archive, WAY_TILE_ZOOM, x, y);
          return bytes.length === 0 ? null : decodeWays(bytes, x, y);
        };
      };
    },
  },
);
