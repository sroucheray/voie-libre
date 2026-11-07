import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

/** Name of the vector source in the style; the Protomaps layers refer to it. */
export const BASEMAP_SOURCE = 'protomaps';

/**
 * Map style over the local basemap. Tiles, glyphs and sprites all come from `baseUrl`
 * (see scripts/download-basemap.sh), so the map never calls an external domain.
 *
 * `language` picks the label names (`name:<language>`, falling back to the local name). Protomaps
 * only generates the label layers when a language is given.
 */
export function buildBasemapStyle(
  baseUrl: string,
  language: string,
): StyleSpecification {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    version: 8,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}/sprites/v4/light`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${base}/clermont.pmtiles`,
        // Attribution is shown by the MapView template, translated.
      },
    },
    layers: layers(BASEMAP_SOURCE, namedFlavor('light'), {
      lang: language,
    }) as StyleSpecification['layers'],
  };
}
