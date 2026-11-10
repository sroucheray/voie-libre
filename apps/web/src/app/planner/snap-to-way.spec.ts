import { haversine } from './elevation-profile';
import {
  SNAP_MAX_METERS,
  snapsToWays,
  snapToWay,
  usableBy,
  type Way,
} from './snap-to-way';

const way = (kind: string, detail: string, line: [number, number][]): Way => ({
  kind,
  detail,
  line,
});
const meters = (a: readonly number[], b: readonly number[]) =>
  haversine([a[0], a[1], 0], [b[0], b[1], 0]);

// About 0.0001° of latitude is 11 m; at latitude 45, 0.0001° of longitude is 7.9 m.
const road = way('minor_road', 'residential', [
  [3, 45],
  [3.01, 45],
]);

describe('snapsToWays', () => {
  it('holds for road and gravel, not for trail', () => {
    expect(snapsToWays('road')).toBe(true);
    expect(snapsToWays('gravel')).toBe(true);
    expect(snapsToWays('trail')).toBe(false);
  });
});

describe('usableBy', () => {
  it('keeps roads for both bikes, and never motorways, rails or footways', () => {
    for (const profile of ['road', 'gravel']) {
      expect(usableBy(profile, way('major_road', 'primary', []))).toBe(true);
      expect(usableBy(profile, way('minor_road', 'service', []))).toBe(true);
      expect(usableBy(profile, way('other', 'living_street', []))).toBe(true);
      expect(usableBy(profile, way('path', 'cycleway', []))).toBe(true);
      expect(usableBy(profile, way('highway', 'motorway', []))).toBe(false);
      expect(usableBy(profile, way('rail', 'rail', []))).toBe(false);
      expect(usableBy(profile, way('other', 'platform', []))).toBe(false);
      expect(usableBy(profile, way('path', 'footway', []))).toBe(false);
      expect(usableBy(profile, way('path', 'steps', []))).toBe(false);
    }
  });

  it('adds tracks and paths for gravel only', () => {
    expect(usableBy('gravel', way('path', 'track', []))).toBe(true);
    expect(usableBy('gravel', way('path', 'path', []))).toBe(true);
    expect(usableBy('road', way('path', 'track', []))).toBe(false);
    expect(usableBy('road', way('path', 'path', []))).toBe(false);
  });

  it('is never true for trail', () => {
    expect(usableBy('trail', road)).toBe(false);
  });
});

describe('snapToWay', () => {
  it('puts a point beside a road on the road, at the closest place', () => {
    const snapped = snapToWay([3.005, 45.0003], [road], 'road');
    expect(snapped).not.toBeNull();
    expect(snapped?.[0]).toBeCloseTo(3.005, 6);
    expect(snapped?.[1]).toBeCloseTo(45, 6);
  });

  it('stops at the end of a way', () => {
    const snapped = snapToWay([2.9995, 45.0002], [road], 'road');
    expect(snapped?.[0]).toBeCloseTo(3, 9);
    expect(snapped?.[1]).toBeCloseTo(45, 9);
  });

  it('refuses a point farther than the limit', () => {
    // About 133 m north of the road.
    expect(snapToWay([3.005, 45.0012], [road], 'road')).toBeNull();
    // About 78 m: within the default limit, beyond a limit of 50 m.
    expect(snapToWay([3.005, 45.0007], [road], 'road')).not.toBeNull();
    expect(snapToWay([3.005, 45.0007], [road], 'road', 50)).toBeNull();
    expect(SNAP_MAX_METERS).toBe(100);
  });

  it('picks the closest of the ways the profile can use', () => {
    const track = way('path', 'track', [
      [3, 45.0002],
      [3.01, 45.0002],
    ]);
    const point: [number, number] = [3.005, 45.00025];
    // The track is 5 m away, the road 28 m.
    const onGravel = snapToWay(point, [road, track], 'gravel');
    expect(onGravel?.[1]).toBeCloseTo(45.0002, 6);
    const onRoad = snapToWay(point, [road, track], 'road');
    expect(onRoad?.[1]).toBeCloseTo(45, 6);
  });

  it('refuses a point with no usable way around', () => {
    const footway = way('path', 'footway', [
      [3, 45],
      [3.01, 45],
    ]);
    expect(snapToWay([3.005, 45.0001], [footway], 'road')).toBeNull();
    expect(snapToWay([3.005, 45.0001], [], 'gravel')).toBeNull();
  });

  it('moves the point by the distance it reports as close', () => {
    const point: [number, number] = [3.0042, 45.0005];
    const snapped = snapToWay(point, [road], 'road') as [number, number];
    expect(meters(point, snapped)).toBeGreaterThan(50);
    expect(meters(point, snapped)).toBeLessThan(60);
  });

  it('keeps a point already on a way where it is', () => {
    const snapped = snapToWay([3.004, 45], [road], 'road');
    expect(snapped?.[0]).toBeCloseTo(3.004, 9);
    expect(snapped?.[1]).toBeCloseTo(45, 9);
  });
});
