import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LngLat3 } from './planner-map-driver';
import { buildProfile, gradeRuns } from './elevation-profile';
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

/**
 * The route cut into runs of one grade band, to draw it in the colours of the elevation profile.
 * With `colourDescents` false the descents take the band of a flat stretch. Empty for a route
 * without a profile.
 */
export function gradesToGeoJson(
  geometry: LngLat3[],
  colourDescents: boolean,
): FeatureCollection<LineString, { band: number }> {
  const profile = buildProfile(geometry);
  if (!profile) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: gradeRuns(profile, colourDescents).map((run) => ({
      type: 'Feature',
      properties: { band: run.band },
      geometry: {
        type: 'LineString',
        coordinates: geometry.slice(run.from, run.to + 1),
      },
    })),
  };
}
