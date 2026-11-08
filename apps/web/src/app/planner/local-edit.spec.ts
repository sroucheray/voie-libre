import { climbOf } from '../import/gpx-import';
import {
  WINDOW_FLOOR_METERS,
  applyStretch,
  cumulativeDistances,
  editWindow,
  projectOnRoute,
  spliceGeometry,
} from './local-edit';
import type { LngLat3 } from './planner-map-driver';
import type { PlannedRoute } from './planner-store';

/** A straight route along the equator, one vertex per 0.001° (about 111 m): 201 vertices. */
const line: LngLat3[] = Array.from({ length: 201 }, (_, i) => [i / 1000, 0, 0]);
const total = cumulativeDistances(line)[200];

describe('projectOnRoute', () => {
  it('finds the closest vertex and the distance to it', () => {
    const { index, distanceMeters } = projectOnRoute(line, [0.1, 0.002]);
    expect(index).toBe(100);
    expect(distanceMeters).toBeGreaterThan(210);
    expect(distanceMeters).toBeLessThan(235);
  });

  it('is 0 for a point on a vertex', () => {
    expect(projectOnRoute(line, [0.05, 0]).distanceMeters).toBeCloseTo(0, 3);
  });
});

describe('editWindow', () => {
  it('takes the floor on each side of a point on the route', () => {
    const { from, to } = editWindow(line, 100, 0);
    const cumulative = cumulativeDistances(line);
    expect(cumulative[100] - cumulative[from]).toBeGreaterThanOrEqual(
      WINDOW_FLOOR_METERS,
    );
    expect(cumulative[100] - cumulative[from + 1]).toBeLessThan(
      WINDOW_FLOOR_METERS,
    );
    expect(to - 100).toBe(100 - from);
  });

  it('grows with the distance from the point to the route', () => {
    const near = editWindow(line, 100, 100);
    const far = editWindow(line, 100, 1000);
    expect(far.from).toBeLessThan(near.from);
    expect(far.to).toBeGreaterThan(near.to);
    // Twice 1000 m on each side: about 18 vertices of 111 m.
    expect(100 - far.from).toBe(18);
    expect(far.to - 100).toBe(18);
  });

  it('never goes beyond the neighbouring points', () => {
    expect(editWindow(line, 100, 1000, { min: 98, max: 101 })).toEqual({
      from: 98,
      to: 101,
    });
  });

  it('stops at the ends of the route', () => {
    expect(editWindow(line, 0, 0).from).toBe(0);
    expect(editWindow(line, 200, 0).to).toBe(200);
  });

  it('always spans two vertices', () => {
    expect(editWindow(line, 100, 0, { min: 100, max: 100 })).toEqual({
      from: 100,
      to: 101,
    });
    expect(editWindow(line, 200, 0, { min: 200, max: 200 })).toEqual({
      from: 199,
      to: 200,
    });
  });
});

describe('spliceGeometry', () => {
  const stretch: LngLat3[] = [
    [0.095, 0, 0],
    [0.1, 0.003, 0],
    [0.105, 0, 0],
  ];

  it('replaces the window and keeps the rest as it was', () => {
    const spliced = spliceGeometry(line, { from: 95, to: 105 }, stretch);
    expect(spliced).toHaveLength(95 + 3 + 95);
    expect(spliced.slice(0, 95)).toEqual(line.slice(0, 95));
    expect(spliced.slice(95, 98)).toEqual(stretch);
    expect(spliced.slice(98)).toEqual(line.slice(106));
  });
});

describe('applyStretch', () => {
  const climbing: LngLat3[] = line.map(([lon, lat], i) => [lon, lat, i]);
  const route: PlannedRoute = {
    geometry: climbing,
    distanceMeters: total,
    ascentMeters: climbOf(climbing.map((p) => p[2])),
    durationSeconds: 3600,
    elevationSource: 'srtm',
  };
  const window = { from: 95, to: 105 };
  const stretch = {
    geometry: [
      [0.095, 0, 95],
      [0.1, 0.003, 100],
      [0.105, 0, 105],
    ] as LngLat3[],
    distanceMeters: 2000,
    ascentMeters: 12,
    durationSeconds: 300,
  };

  it('splices the geometry and keeps the other fields', () => {
    const edited = applyStretch(route, window, stretch);
    expect(edited.geometry).toEqual(
      spliceGeometry(climbing, window, stretch.geometry),
    );
    expect(edited.elevationSource).toBe('srtm');
  });

  it('adds the new stretch to the part that is kept', () => {
    const edited = applyStretch(route, window, stretch);
    const cumulative = cumulativeDistances(climbing);
    const share = 1 - (cumulative[105] - cumulative[95]) / total;
    expect(edited.distanceMeters).toBeCloseTo(total * share + 2000, 3);
    expect(edited.durationSeconds).toBeCloseTo(3600 * share + 300, 6);
  });

  it('takes the climb of the replaced vertices off and adds the new one', () => {
    const edited = applyStretch(route, window, stretch);
    const removed = climbOf(climbing.slice(95, 106).map((p) => p[2]));
    expect(removed).toBeGreaterThan(0);
    expect(edited.ascentMeters).toBe((route.ascentMeters ?? 0) - removed + 12);
  });

  it('keeps an unknown climb unknown', () => {
    const edited = applyStretch(
      { ...route, ascentMeters: null },
      window,
      stretch,
    );
    expect(edited.ascentMeters).toBeNull();
  });
});
