import { InjectionToken } from '@angular/core';

/**
 * Where the hillshade gets its elevations: the public AWS Terrain Tiles (default), or the file made
 * from the Copernicus data (`scripts/build-relief-tiles.ts`) and served with the basemap.
 */
export type ReliefSourceKind = 'public' | 'local';

export const RELIEF_SOURCE_KIND = new InjectionToken<ReliefSourceKind>(
  'RELIEF_SOURCE_KIND',
  { providedIn: 'root', factory: () => 'public' },
);

/**
 * AWS Terrain Tiles ("Terrarium" encoding): 256 px PNG, zooms 0 to 15, no key, CORS open. The data
 * is stable (last modified in 2017); the sources to credit are listed at {@link RELIEF_CREDIT_URL}.
 */
export const PUBLIC_RELIEF_HOST = 's3.amazonaws.com';
export const PUBLIC_RELIEF_MAX_ZOOM = 15;
export const publicReliefTileUrl = (z: number, x: number, y: number) =>
  `https://${PUBLIC_RELIEF_HOST}/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** The sources of the terrain tiles (Mapzen's attribution list). */
export const RELIEF_CREDIT_URL =
  'https://github.com/tilezen/joerd/blob/master/docs/attribution.md';

/** Zooms of the public tiles an offline area keeps: deeper ones are drawn from these. */
export const PUBLIC_RELIEF_OFFLINE_MIN_ZOOM = 6;
export const PUBLIC_RELIEF_OFFLINE_MAX_ZOOM = 12;

/**
 * The scheme of the tile URLs of the hillshade in the style. MapLibre hands them to the protocol
 * registered with the map (`map-factory.ts`), which reads a tile kept offline before the network.
 */
export const RELIEF_PROTOCOL = 'vlterrain';
