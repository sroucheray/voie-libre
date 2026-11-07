import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LngLat3 } from './planner-map-driver';

/**
 * One line per route. `selected` tells the style which one to emphasise, and `index` lets a
 * click on an alternative tell which route was hit.
 */
export function routesToGeoJson(
  routes: LngLat3[][],
  selected: number,
): FeatureCollection<LineString, { index: number; selected: boolean }> {
  const features: Feature<LineString, { index: number; selected: boolean }>[] =
    routes.map((coordinates, index) => ({
      type: 'Feature',
      properties: { index, selected: index === selected },
      geometry: { type: 'LineString', coordinates },
    }));
  return { type: 'FeatureCollection', features };
}
