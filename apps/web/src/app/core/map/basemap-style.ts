import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import {
  RELIEF_MAX_ZOOM,
  RELIEF_MIN_ZOOM,
  RELIEF_TILE_SIZE,
  RELIEF_TILES_FILE,
} from '@voie-libre/shared';

/** Name of the vector source in the style; the Protomaps layers refer to it. */
export const BASEMAP_SOURCE = 'protomaps';

/** The PMTiles archive of the region, relative to the basemap URL. */
export const BASEMAP_TILES_FILE = 'clermont.pmtiles';

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

export interface BasemapStyleOptions {
  /** Draws the hillshade. Only when the archive of elevation tiles exists. */
  relief?: boolean;
}

/**
 * Map style over the local basemap. Tiles, glyphs and sprites all come from `baseUrl`
 * (see scripts/download-basemap.sh), so the map never calls an external domain.
 *
 * `language` picks the label names (`name:<language>`, falling back to the local name). Protomaps
 * only generates the label layers when a language is given.
 *
 * With `relief`, a hillshade computed by MapLibre from the local elevation tiles is drawn under
 * the water and the roads.
 */
export function buildBasemapStyle(
  baseUrl: string,
  language: string,
  options: BasemapStyleOptions = {},
): StyleSpecification {
  const base = baseUrl.replace(/\/+$/, '');
  const basemap = layers(BASEMAP_SOURCE, namedFlavor('light'), {
    lang: language,
  }) as StyleSpecification['layers'];
  if (!options.relief) return styleOf(base, {}, basemap);
  const at = basemap.findIndex((layer) => layer.id === RELIEF_BEFORE);
  const index = at === -1 ? basemap.length : at;
  return styleOf(
    base,
    {
      [RELIEF_SOURCE]: {
        type: 'raster-dem',
        url: `pmtiles://${reliefTilesUrl(base)}`,
        encoding: 'terrarium',
        tileSize: RELIEF_TILE_SIZE,
        minzoom: RELIEF_MIN_ZOOM,
        maxzoom: RELIEF_MAX_ZOOM,
      },
    },
    [
      ...basemap.slice(0, index),
      {
        id: RELIEF_LAYER,
        type: 'hillshade',
        source: RELIEF_SOURCE,
        paint: {
          // Soft: the roads, the route and the names must stay easy to read.
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': '#4b5563',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#6b7280',
        },
      },
      ...basemap.slice(index),
    ],
  );
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
