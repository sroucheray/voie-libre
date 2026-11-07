import { outboundAvoidZone, routeLoop, simplify } from './loops';
import {
  type AvoidZone,
  type Position,
  type RouteResult,
  RoutingError,
  type RoutingProvider,
} from './routing-provider';

const A = { lon: 3, lat: 45 };
const B = { lon: 3.1, lat: 45 };
const C = { lon: 3.1, lat: 45.1 };

/** A straight way along a parallel, one vertex every ~80 m. */
const line = (from: Position, to: Position, steps = 100) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [
      from.lon + (to.lon - from.lon) * t,
      from.lat + (to.lat - from.lat) * t,
      100,
    ] as [number, number, number];
  });

const leg = (from: Position, to: Position): RouteResult => ({
  geometry: line(from, to),
  distanceMeters: 1000,
  ascentMeters: 10,
  durationSeconds: 100,
});

describe('simplify', () => {
  it('drops the points of a straight line and keeps a corner', () => {
    const corner = [...line(A, B, 20), ...line(B, C, 20).slice(1)] as [
      number,
      number,
      number,
    ][];
    const kept = simplify(corner, 15);
    expect(kept).toHaveLength(3);
    expect(kept[1][0]).toBeCloseTo(B.lon, 6);
  });
});

describe('outboundAvoidZone', () => {
  it('is a polyline without the first and last stretch', () => {
    const geometry = line(A, B);
    const zone = outboundAvoidZone(geometry);
    expect(zone?.kind).toBe('polyline');
    if (zone?.kind !== 'polyline') return;
    expect(zone.points[0].lon).toBeGreaterThan(A.lon);
    expect(zone.points[zone.points.length - 1].lon).toBeLessThan(B.lon);
  });

  it('keeps a long way out under the point cap', () => {
    // A zig-zag that Douglas-Peucker cannot flatten.
    const zigzag = Array.from(
      { length: 3000 },
      (_, i) =>
        [3 + i * 0.0003, 45 + (i % 2) * 0.0008, 0] as [number, number, number],
    );
    const zone = outboundAvoidZone(zigzag);
    expect(zone?.kind === 'polyline' && zone.points.length).toBeLessThanOrEqual(
      350,
    );
  });

  it('is null when the way out is shorter than the stretches kept open', () => {
    expect(outboundAvoidZone(line(A, { lon: 3.005, lat: 45 }, 5))).toBeNull();
  });
});

describe('routeLoop', () => {
  let calls: { points: Position[]; zones: AvoidZone[]; alternatives: number }[];
  const provider = (failAvoiding = false): RoutingProvider => ({
    name: 'fake',
    route: async (points, _profile, zones, alternatives) => {
      calls.push({ points, zones, alternatives });
      if (failAvoiding && zones.some((z) => z.kind === 'polyline')) {
        throw new RoutingError('no_route', 'blocked');
      }
      const route = leg(points[0], points[points.length - 1]);
      return Array.from({ length: alternatives }, () => route);
    },
  });

  beforeEach(() => {
    calls = [];
  });

  it('routes the way out, then the way back avoiding it, and joins them', async () => {
    const [route] = await routeLoop(provider(), [A, B, A], 'road', [], 1, {
      mode: 'avoid_outbound',
    });
    expect(calls[0].points).toEqual([A, B]);
    expect(calls[1].points).toEqual([B, A]);
    expect(calls[1].zones.map((z) => z.kind)).toEqual(['polyline']);
    expect(route.distanceMeters).toBe(2000);
    expect(route.ascentMeters).toBe(20);
    expect(route.durationSeconds).toBe(200);
    // The way back starts where the way out ends: that point is not repeated.
    expect(route.geometry).toHaveLength(101 + 100);
  });

  it('keeps the waypoints on the way out and the last one as the turnaround', async () => {
    await routeLoop(provider(), [A, C, B, A], 'road', [], 1, {
      mode: 'avoid_outbound',
    });
    expect(calls[0].points).toEqual([A, C, B]);
    expect(calls[1].points).toEqual([B, A]);
  });

  it('computes a way back for each alternative way out', async () => {
    const routes = await routeLoop(provider(), [A, B, A], 'road', [], 3, {
      mode: 'avoid_outbound',
    });
    expect(routes).toHaveLength(3);
    // One way out request, then three ways back.
    expect(calls).toHaveLength(4);
  });

  it('falls back to the plain way back when none avoids the way out', async () => {
    const [route] = await routeLoop(provider(true), [A, B, A], 'road', [], 1, {
      mode: 'avoid_outbound',
    });
    expect(route.distanceMeters).toBe(2000);
    expect(calls.at(-1)?.zones).toEqual([]);
  });

  it("keeps the caller's own zones on both ways", async () => {
    const zone: AvoidZone = { kind: 'circle', center: C, radiusMeters: 100 };
    await routeLoop(provider(), [A, B, A], 'road', [zone], 1, {
      mode: 'avoid_outbound',
    });
    expect(calls[0].zones).toEqual([zone]);
    expect(calls[1].zones[0]).toEqual(zone);
  });

  it('refuses points that do not end on the start', async () => {
    await expect(
      routeLoop(provider(), [A, B, C], 'road', [], 1, {
        mode: 'avoid_outbound',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      routeLoop(provider(), [A, A], 'road', [], 1, { mode: 'avoid_outbound' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  describe('by distance', () => {
    it('asks the engine for round trips from the start', async () => {
      const roundTrip = jest.fn().mockResolvedValue([leg(A, A)]);
      const result = await routeLoop(
        { name: 'fake', route: async () => [], roundTrip },
        [A, A],
        'gravel',
        [],
        2,
        { mode: 'distance', distanceMeters: 30_000 },
      );
      expect(roundTrip).toHaveBeenCalledWith(A, 'gravel', [], 2, 30_000);
      expect(result).toHaveLength(1);
    });

    it('refuses extra points, and an engine without round trips', async () => {
      const loop = { mode: 'distance', distanceMeters: 30_000 } as const;
      await expect(
        routeLoop(
          { name: 'fake', route: async () => [], roundTrip: async () => [] },
          [A, B],
          'road',
          [],
          1,
          loop,
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(
        routeLoop(
          { name: 'fake', route: async () => [] },
          [A, A],
          'road',
          [],
          1,
          loop,
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });
  });
});
