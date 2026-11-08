import type { LngLat } from '../core/map/map-factory';

const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * A GeoJSON polygon approximating the circle of `radiusMeters` around `center`, to draw the
 * accuracy of a position on the map. Small distances only (a few kilometres at most).
 */
export function accuracyCircle(
  center: LngLat,
  radiusMeters: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = center;
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(latRad), 1e-6);
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}
