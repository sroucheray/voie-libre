import { describe, expect, it } from 'vitest';
import { accuracyCircle } from './accuracy-circle';

/** Great-circle distance in metres (haversine). */
function distance(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

describe('accuracyCircle', () => {
  it('is a closed ring whose points all lie at the radius', () => {
    const center: [number, number] = [3.08, 45.78];
    const ring = accuracyCircle(center, 120).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const point of ring) {
      expect(distance(center, point as [number, number])).toBeCloseTo(120, 0);
    }
  });

  it('stays valid at a high latitude', () => {
    const ring = accuracyCircle([10, 78], 50).geometry.coordinates[0];
    expect(ring.every(([lng, lat]) => Number.isFinite(lng + lat))).toBe(true);
  });
});
