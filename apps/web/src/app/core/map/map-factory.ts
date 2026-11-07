import { InjectionToken } from '@angular/core';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import {
  OfflineFirstSource,
  type OfflineTilesReader,
} from '../offline/tiles-source';

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
  offlineTiles?: OfflineTiles;
}

export type MapFactory = (options: MapCreateOptions) => Promise<MapLike>;

/** Where the basemap is served (the `tiles` service of docker-compose). Override per environment. */
export const BASEMAP_URL = new InjectionToken<string>('BASEMAP_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8081',
});

let pmtilesRegistered = false;

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
    if (offlineTiles) {
      // Registered under the URL the style uses: the map reads the downloaded copy when there is
      // one, and falls back to HTTP range requests.
      protocol.add(
        new PMTiles(
          new OfflineFirstSource(
            offlineTiles.url,
            offlineTiles.reader,
            new FetchSource(offlineTiles.url),
          ),
        ),
      );
    }
    maplibre.addProtocol('pmtiles', protocol.tile);
    // The worker is an asset of the app (see project.json): the bundler cannot locate it beside the
    // library, which breaks the dev server and hashed production builds alike.
    maplibre.setWorkerUrl(
      new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href,
    );
    pmtilesRegistered = true;
  }
  return new maplibre.Map({
    container,
    style,
    center,
    zoom,
    maxZoom: 18,
    // Controls and attribution are Angular elements, so they follow the UI language.
    attributionControl: false,
  });
};

export const MAP_FACTORY = new InjectionToken<MapFactory>('MAP_FACTORY', {
  providedIn: 'root',
  factory: () => createMapLibreMap,
});
