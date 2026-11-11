import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LngLat3 } from './planner-map-driver';
import { surfaceRuns, type SurfaceCode } from './route-surface';

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

/**
 * The route cut into runs of one category, to draw it in the colour of what it rides on. Empty
 * when the codes do not fit the geometry.
 */
export function surfacesToGeoJson(
  geometry: LngLat3[],
  surfaces: string,
): FeatureCollection<LineString, { code: SurfaceCode }> {
  if (surfaces.length !== geometry.length - 1) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: surfaceRuns(surfaces).map((run) => ({
      type: 'Feature',
      properties: { code: run.code },
      geometry: {
        type: 'LineString',
        coordinates: geometry.slice(run.from, run.to + 1),
      },
    })),
  };
}
