import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import {
  RELIEF_MAX_ZOOM,
  RELIEF_MIN_ZOOM,
  RELIEF_TILE_SIZE,
  RELIEF_TILES_FILE,
} from '@voie-libre/shared';
import { wayLayers } from './way-levels';
import { PALETTE } from './palette';

/** Name of the vector source in the style; the Protomaps layers refer to it. */
export const BASEMAP_SOURCE = 'protomaps';

/** The PMTiles archive of the region, relative to the basemap URL. */
export const BASEMAP_TILES_FILE = 'basemap.pmtiles';

/** Full URL of the PMTiles archive; it is also the key the offline copy is stored under. */
export function basemapTilesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${BASEMAP_TILES_FILE}`;
}

/** Name of the elevation source and of the hillshade layer drawn from it. */
export const RELIEF_SOURCE = 'relief';
export const RELIEF_LAYER = 'relief';
/** The hillshade goes under this layer: above the land cover, under water, roads and labels. */
const RELIEF_BEFORE = 'water';

/** Full URL of the archive of elevation tiles (see scripts/build-relief-tiles.ts). */
export function reliefTilesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${RELIEF_TILES_FILE}`;
}

/** The only external host the map can call, and only when the user turns the aerial photos on. */
export const IMAGERY_HOST = 'data.geopf.fr';
export const IMAGERY_SOURCE = 'imagery';
export const IMAGERY_LAYER = 'imagery';
/** IGN Géoplateforme, layer `ORTHOIMAGERY.ORTHOPHOTOS`: 256 px JPEG tiles, Web Mercator, zooms 6 to 19. */
export const IMAGERY_TILES = `https://${IMAGERY_HOST}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

export interface BasemapStyleOptions {
  /** Draws the hillshade. Only when the archive of elevation tiles exists. */
  relief?: boolean;
  /** Draws the ways by how well they suit this profile (`road`, `gravel`, `trail`). */
  ways?: string | null;
  /** Draws the IGN's aerial photos under the roads and the names. Calls an external server. */
  imagery?: boolean;
}

/**
 * Map style over the local basemap. Tiles, glyphs and sprites all come from `baseUrl`
 * (see scripts/download-basemap.sh), so the map never calls an external domain, unless `imagery`.
 *
 * `language` picks the label names (`name:<language>`, falling back to the local name). Protomaps
 * only generates the label layers when a language is given.
 *
 * With `relief`, a hillshade computed by MapLibre from the local elevation tiles is drawn under
 * the water and the roads (over the photos, when there are some). With `ways`, the roads, tracks
 * and paths are drawn again in three colours by how well they suit the profile, above the roads
 * and under the labels. With `imagery`, the IGN's aerial photos take the place of the basemap's
 * land, water and buildings; the roads and the names stay on top of them.
 */
export function buildBasemapStyle(
  baseUrl: string,
  language: string,
  options: BasemapStyleOptions = {},
): StyleSpecification {
  const base = baseUrl.replace(/\/+$/, '');
  const sources: StyleSpecification['sources'] = {};
  let styleLayers = layers(BASEMAP_SOURCE, namedFlavor('light'), {
    lang: language,
  }) as StyleSpecification['layers'];

  if (options.imagery) {
    sources[IMAGERY_SOURCE] = {
      type: 'raster',
      tiles: [IMAGERY_TILES],
      tileSize: 256,
      minzoom: 6,
      maxzoom: 19,
      // Attribution is shown by the MapView template, translated.
    };
    styleLayers = withImageryLayer(styleLayers);
  }
  if (options.ways) {
    styleLayers = withWayLayers(
      styleLayers,
      wayLayers(BASEMAP_SOURCE, options.ways),
    );
  }
  if (options.relief) {
    sources[RELIEF_SOURCE] = {
      type: 'raster-dem',
      url: `pmtiles://${reliefTilesUrl(base)}`,
      encoding: 'terrarium',
      tileSize: RELIEF_TILE_SIZE,
      minzoom: RELIEF_MIN_ZOOM,
      maxzoom: RELIEF_MAX_ZOOM,
    };
    // Under the water; with photos (which replace the water), right over them.
    const water = styleLayers.findIndex((layer) => layer.id === RELIEF_BEFORE);
    const photos = styleLayers.findIndex((layer) => layer.id === IMAGERY_LAYER);
    const index =
      water !== -1 ? water : photos !== -1 ? photos + 1 : styleLayers.length;
    styleLayers = [
      ...styleLayers.slice(0, index),
      {
        id: RELIEF_LAYER,
        type: 'hillshade',
        source: RELIEF_SOURCE,
        paint: {
          // Soft: the roads, the route and the names must stay easy to read.
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': PALETTE.hillshade.shadow,
          'hillshade-highlight-color': PALETTE.hillshade.highlight,
          'hillshade-accent-color': PALETTE.hillshade.accent,
        },
      },
      ...styleLayers.slice(index),
    ];
  }
  return styleOf(base, sources, styleLayers);
}

/** The photos replace every filled layer (land, water, buildings): roads and labels stay. */
function withImageryLayer(
  basemap: StyleSpecification['layers'],
): StyleSpecification['layers'] {
  const kept = basemap.filter((layer) => layer.type !== 'fill');
  const background = kept.findIndex((layer) => layer.type === 'background');
  return [
    ...kept.slice(0, background + 1),
    { id: IMAGERY_LAYER, type: 'raster', source: IMAGERY_SOURCE },
    ...kept.slice(background + 1),
  ];
}

/** The way layers go before the first label layer: above every road, under the names. */
function withWayLayers(
  basemap: StyleSpecification['layers'],
  ways: StyleSpecification['layers'],
): StyleSpecification['layers'] {
  const at = basemap.findIndex((layer) => layer.type === 'symbol');
  const index = at === -1 ? basemap.length : at;
  return [...basemap.slice(0, index), ...ways, ...basemap.slice(index)];
}

function styleOf(
  base: string,
  sources: StyleSpecification['sources'],
  styleLayers: StyleSpecification['layers'],
): StyleSpecification {
  return {
    version: 8,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/sprites/v4/light`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${basemapTilesUrl(base)}`,
        // Attribution is shown by the MapView template, translated.
      },
      ...sources,
    },
    layers: styleLayers,
  };
}
