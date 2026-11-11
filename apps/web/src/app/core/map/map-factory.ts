import { InjectionToken } from '@angular/core';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import {
  OfflineFirstSource,
  type OfflineTilesReader,
} from '../offline/tiles-source';
import type { Box } from '../offline/area-tiles';
import { retryFailedTiles } from './failed-tiles';

/** `[longitude, latitude]`. */
export type LngLat = [number, number];

/** The part of the MapLibre map the app uses, so tests can provide a fake. */
export type MapLike = Pick<
  MapLibreMap,
  | 'on'
  | 'getCenter'
  | 'getZoom'
  | 'getBearing'
  | 'jumpTo'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetNorth'
  | 'resize'
  | 'setStyle'
  | 'remove'
>;

/** The offline copy of the PMTiles archive, which the map reads before the network. */
export interface OfflineTiles {
  /** Where the archive is served; also its key in the PMTiles protocol. */
  url: string;
  reader: OfflineTilesReader;
}

export interface MapCreateOptions {
  container: HTMLElement;
  style: StyleSpecification;
  center: LngLat;
  zoom: number;
  /** The archives the map reads from the device when they are downloaded. */
  offlineTiles?: OfflineTiles[];
}

export type MapFactory = (options: MapCreateOptions) => Promise<MapLike>;

/** Where the basemap is served (the `tiles` service of docker-compose). Override per environment. */
export const BASEMAP_URL = new InjectionToken<string>('BASEMAP_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8081',
});

let pmtilesRegistered = false;

/** Reads a tile of a PMTiles archive, once the map registered the protocol. */
type TileReader = (
  archiveUrl: string,
  z: number,
  x: number,
  y: number,
) => Promise<Uint8Array>;
let tileReader: TileReader | null = null;
/** The PMTiles archives of the map, by URL, once the map registered them. */
const archives = new Map<string, { getHeader(): Promise<HeaderBounds> }>();

interface HeaderBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * The box the basemap archive at `url` covers, from its header (the map reads it anyway); `null`
 * while no map was created or when the header cannot be read.
 */
export async function basemapBounds(url: string): Promise<Box | null> {
  const archive = archives.get(url);
  if (!archive) return null;
  try {
    const { minLon, minLat, maxLon, maxLat } = await archive.getHeader();
    return [minLon, minLat, maxLon, maxLat];
  } catch {
    return null;
  }
}

/** Tells the box the basemap covers (a token so that tests can say). */
export const BASEMAP_COVERAGE = new InjectionToken<
  (url: string) => Promise<Box | null>
>('BASEMAP_COVERAGE', { providedIn: 'root', factory: () => basemapBounds });

/**
 * The reader of the basemap's tiles, the same the map uses (offline copy first), or `null` while
 * no map was created: other parts of the app read tiles through it (see `way-tiles.ts`). A tile
 * the archive does not hold comes back empty.
 */
export function basemapTileReader(): TileReader | null {
  return tileReader;
}

/**
 * Creates the real MapLibre map. MapLibre and PMTiles are imported on demand: they are large and
 * stay out of the initial bundle. The `pmtiles://` protocol is registered once per page.
 */
export const createMapLibreMap: MapFactory = async ({
  container,
  style,
  center,
  zoom,
  offlineTiles,
}) => {
  const [maplibre, { Protocol, PMTiles, FetchSource }] = await Promise.all([
    import('maplibre-gl'),
    import('pmtiles'),
  ]);
  if (!pmtilesRegistered) {
    const protocol = new Protocol();
    for (const tiles of offlineTiles ?? []) {
      // Registered under the URL the style uses: the map reads the downloaded copy when there is
      // one, and falls back to HTTP range requests.
      const archive = new PMTiles(
        new OfflineFirstSource(
          tiles.url,
          tiles.reader,
          new FetchSource(tiles.url),
        ),
      );
      archives.set(tiles.url, archive);
      protocol.add(archive);
    }
    maplibre.addProtocol('pmtiles', protocol.tile);
    tileReader = async (archiveUrl, z, x, y) => {
      const { data } = await protocol.tile(
        { url: `pmtiles://${archiveUrl}/${z}/${x}/${y}`, type: 'arrayBuffer' },
        new AbortController(),
      );
      return new Uint8Array(data as ArrayBuffer);
    };
    // The worker is an asset of the app (see project.json): the bundler cannot locate it beside the
    // library, which breaks the dev server and hashed production builds alike.
    maplibre.setWorkerUrl(
      new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href,
    );
    pmtilesRegistered = true;
  }
  const map = new maplibre.Map({
    container,
    style,
    center,
    zoom,
    maxZoom: 18,
    // Controls and attribution are Angular elements, so they follow the UI language.
    attributionControl: false,
  });
  retryFailedTiles(map);
  return map;
};

export const MAP_FACTORY = new InjectionToken<MapFactory>('MAP_FACTORY', {
  providedIn: 'root',
  factory: () => createMapLibreMap,
});
