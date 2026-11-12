import { climbOf } from '../import/gpx-import';
import {
  WINDOW_FLOOR_METERS,
  applyStretch,
  cumulativeDistances,
  editWindow,
  planLocalEdit,
  projectOnRoute,
  shouldComputeInFull,
  type LocalEditPlan,
  spliceGeometry,
  spliceSurfaces,
} from './local-edit';
import type { LngLat3 } from './planner-map-driver';
import type { PlannedRoute, PointEdit } from './planner-store';

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

describe('spliceSurfaces', () => {
  it('keeps the codes before the window and from its last vertex, and brings the stretch', () => {
    // 10 vertices, 9 segments (a to i); the window is vertices 3 to 5, replaced by 2 segments.
    expect(spliceSurfaces('abcdefghi', { from: 3, to: 5 }, 'XY')).toBe(
      'abcXYfghi',
    );
    // A window from the first vertex to the last takes everything.
    expect(spliceSurfaces('abcdefghi', { from: 0, to: 9 }, 'XYZ')).toBe('XYZ');
  });

  it('has as many codes as the new geometry has segments', () => {
    const geometry = line.slice(0, 11);
    const stretch = line.slice(3, 6);
    const spliced = spliceGeometry(geometry, { from: 3, to: 5 }, stretch);
    expect(
      spliceSurfaces('p'.repeat(10), { from: 3, to: 5 }, 'uu'),
    ).toHaveLength(spliced.length - 1);
  });

  it('says nothing when the route or the stretch does not tell', () => {
    expect(spliceSurfaces(undefined, { from: 1, to: 2 }, 'p')).toBeUndefined();
    expect(
      spliceSurfaces('ppp', { from: 1, to: 2 }, undefined),
    ).toBeUndefined();
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

  it('splices the surfaces, and drops them when the stretch has none', () => {
    const withSurfaces = { ...route, surfaces: 'p'.repeat(200) };
    const edited = applyStretch(withSurfaces, window, {
      ...stretch,
      surfaces: 'uu',
    });
    expect(edited.surfaces).toHaveLength(edited.geometry.length - 1);
    expect(edited.surfaces).toBe('p'.repeat(95) + 'uu' + 'p'.repeat(95));
    expect(
      applyStretch(withSurfaces, window, stretch).surfaces,
    ).toBeUndefined();
  });

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

describe('planLocalEdit', () => {
  const route: [number, number][] = [
    [0, 0],
    [0.1, 0],
    [0.2, 0],
  ];
  const edit = (
    partial:
      | { kind: 'insert'; index: number; point: [number, number] }
      | {
          kind: 'move';
          index: number;
          from: [number, number];
          point: [number, number];
        }
      | { kind: 'remove'; index: number; point: [number, number] },
    next: [number, number][],
  ): PointEdit => ({ ...partial, previous: route, next });
  const vertex = (i: number): [number, number] => [line[i][0], line[i][1]];

  it('routes an inserted point from the route before the window to the route after it', () => {
    const point: [number, number] = [0.05, 0.004];
    const plan = planLocalEdit(
      line,
      edit({ kind: 'insert', index: 1, point }, [
        route[0],
        point,
        ...route.slice(1),
      ]),
    );
    expect(plan).not.toBeNull();
    const { window, points } = plan as LocalEditPlan;
    // Beside the route by about 445 m: 890 m on each side of vertex 50.
    expect(window.from).toBeLessThan(50);
    expect(window.to).toBeGreaterThan(50);
    expect(points).toEqual([vertex(window.from), point, vertex(window.to)]);
  });

  it('stays between the neighbouring points when the point lands in the second half', () => {
    const point: [number, number] = [0.15, 0.001];
    const plan = planLocalEdit(
      line,
      edit({ kind: 'insert', index: 2, point }, [
        route[0],
        route[1],
        point,
        route[2],
      ]),
    ) as LocalEditPlan;
    expect(plan.window.from).toBeGreaterThanOrEqual(100);
    expect(plan.window.to).toBeLessThanOrEqual(200);
  });

  it('reroutes the stretch around a moved waypoint', () => {
    const point: [number, number] = [0.1, 0.003];
    const plan = planLocalEdit(
      line,
      edit({ kind: 'move', index: 1, from: route[1], point }, [
        route[0],
        point,
        route[2],
      ]),
    ) as LocalEditPlan;
    expect(plan.points).toHaveLength(3);
    expect(plan.points[1]).toEqual(point);
    expect(plan.window.from).toBeLessThan(100);
    expect(plan.window.to).toBeGreaterThan(100);
  });

  it('replaces the route up to a moved start, and from a moved end', () => {
    const start: [number, number] = [0.002, 0.001];
    const moved = planLocalEdit(
      line,
      edit({ kind: 'move', index: 0, from: route[0], point: start }, [
        start,
        route[1],
        route[2],
      ]),
    ) as LocalEditPlan;
    expect(moved.window.from).toBe(0);
    expect(moved.points).toHaveLength(2);
    expect(moved.points[0]).toEqual(start);

    const end: [number, number] = [0.198, 0.001];
    const endMoved = planLocalEdit(
      line,
      edit({ kind: 'move', index: 2, from: route[2], point: end }, [
        route[0],
        route[1],
        end,
      ]),
    ) as LocalEditPlan;
    expect(endMoved.window.to).toBe(200);
    expect(endMoved.points).toHaveLength(2);
    expect(endMoved.points[1]).toEqual(end);
  });

  it('routes a removed waypoint between its two neighbours, replacing all that lies between', () => {
    const plan = planLocalEdit(
      line,
      edit({ kind: 'remove', index: 1, point: route[1] }, [route[0], route[2]]),
    ) as LocalEditPlan;
    expect(plan.window).toEqual({ from: 0, to: 200 });
    expect(plan.points).toEqual([vertex(0), vertex(200)]);
  });

  it('keeps the route beyond the neighbours of a removed waypoint', () => {
    const previous: [number, number][] = [
      [0, 0],
      [0.05, 0],
      [0.1, 0],
      [0.15, 0],
      [0.2, 0],
    ];
    const plan = planLocalEdit(line, {
      kind: 'remove',
      index: 2,
      point: previous[2],
      previous,
      next: previous.filter((_, i) => i !== 2),
    }) as LocalEditPlan;
    expect(plan.window).toEqual({ from: 50, to: 150 });
    expect(plan.points).toEqual([vertex(50), vertex(150)]);
  });

  it('asks for a full computation when the neighbours of a removed waypoint are the same place', () => {
    const tip = 100;
    // A loop out to its only stop and back: [start, tip, start].
    const loop: LngLat3[] = [
      ...line.slice(0, tip + 1),
      ...line.slice(0, tip).reverse(),
    ];
    expect(
      planLocalEdit(loop, {
        kind: 'remove',
        index: 1,
        point: [0.1, 0],
        previous: [
          [0, 0],
          [0.1, 0],
          [0, 0],
        ],
        next: [
          [0, 0],
          [0, 0],
        ],
      }),
    ).toBeNull();
  });

  it('asks for a full computation when a start or an end is removed, or little is left', () => {
    expect(
      planLocalEdit(
        line,
        edit({ kind: 'remove', index: 0, point: route[0] }, [
          route[1],
          route[2],
        ]),
      ),
    ).toBeNull();
    expect(
      planLocalEdit(
        line,
        edit({ kind: 'remove', index: 2, point: route[2] }, [
          route[0],
          route[1],
        ]),
      ),
    ).toBeNull();
    expect(
      planLocalEdit(
        line,
        edit({ kind: 'remove', index: 1, point: route[1] }, [route[0]]),
      ),
    ).toBeNull();
  });
});

describe('shouldComputeInFull', () => {
  type P = [number, number];
  /** 111 km along the equator, a vertex per 0.01° (about 1.1 km): beyond the short-route limit. */
  const longLine: LngLat3[] = Array.from({ length: 101 }, (_, i) => [
    i / 100,
    0,
    0,
  ]);
  const ends: P[] = [
    [0, 0],
    [1, 0],
  ];
  const insert = (point: P, geometry = longLine, previous = ends): boolean =>
    shouldComputeInFull(geometry, {
      kind: 'insert',
      index: 1,
      point,
      previous,
      next: [previous[0], point, previous[1]],
    } as PointEdit);

  it('computes in full what was chosen on purpose, even beside the route', () => {
    expect(
      shouldComputeInFull(longLine, {
        kind: 'insert',
        index: 1,
        point: [0.5, 0.001],
        previous: ends,
        next: [ends[0], [0.5, 0.001], ends[1]],
        deliberate: true,
      }),
    ).toBe(true);
  });

  it('computes a short route in full whatever the edit', () => {
    const short: LngLat3[] = Array.from({ length: 21 }, (_, i) => [
      i / 100,
      0,
      0,
    ]);
    const shortEnds: P[] = [
      [0, 0],
      [0.2, 0],
    ];
    expect(insert([0.1, 0.001], short, shortEnds)).toBe(true);
  });

  it('keeps a stretch for a point beside the route of a long trip', () => {
    // 111 m off the route, nowhere near 2 km nor a tenth of the 111 km between the ends.
    expect(insert([0.5, 0.001])).toBe(false);
  });

  it('computes in full for a point far from the route', () => {
    // 0.05° is about 5.5 km off: the way there may leave the route altogether.
    expect(insert([0.5, 0.05])).toBe(true);
  });

  it('keeps a stretch for a removed stop on a long trip', () => {
    const stops: P[] = [ends[0], [0.5, 0], ends[1]];
    expect(
      shouldComputeInFull(longLine, {
        kind: 'remove',
        index: 1,
        point: [0.5, 0],
        previous: stops,
        next: ends,
      }),
    ).toBe(false);
  });

  it('treats a move like an insert: near keeps a stretch, far computes in full', () => {
    const stops: P[] = [ends[0], [0.5, 0], ends[1]];
    const move = (to: P) =>
      shouldComputeInFull(longLine, {
        kind: 'move',
        index: 1,
        from: [0.5, 0],
        point: to,
        previous: stops,
        next: [stops[0], to, stops[2]],
      });
    expect(move([0.5, 0.002])).toBe(false);
    expect(move([0.5, 0.04])).toBe(true);
  });
});
