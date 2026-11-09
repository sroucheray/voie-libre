import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRouterProvider, avoidZoneParams } from './brouter-provider';
import { RoutingError } from './routing-provider';

// Reduced copy of a real response recorded in spike/brouter/results (Clermont-Ferrand to Issoire).
const recorded = readFileSync(
  join(__dirname, '__fixtures__/brouter-alt0.geojson'),
  'utf8',
);

const A = { lon: 3.087, lat: 45.777 };
const B = { lon: 3.249, lat: 45.544 };

const respond =
  (body: string, status = 200) =>
  async () =>
    new Response(body, { status });

describe('BRouterProvider', () => {
  it('returns geometry, distance, ascent and duration from a recorded response', async () => {
    const provider = new BRouterProvider(
      'http://brouter:17777/',
      respond(recorded),
    );
    const [route] = await provider.route([A, B], 'road', [], 1);
    expect(route.distanceMeters).toBe(
      Number(JSON.parse(recorded).features[0].properties['track-length']),
    );
    expect(route.ascentMeters).toBeGreaterThan(0);
    expect(route.durationSeconds).toBeGreaterThan(0);
    expect(route.geometry.length).toBeGreaterThanOrEqual(2);
    expect(route.geometry[0]).toHaveLength(3);
  });

  it('asks BRouter for one route per alternative with the mapped profile', async () => {
    const urls: string[] = [];
    const provider = new BRouterProvider(
      'http://brouter:17777',
      async (url) => {
        urls.push(url);
        return new Response(recorded);
      },
    );
    const routes = await provider.route([A, B], 'gravel', [], 3);
    expect(routes).toHaveLength(3);
    expect(urls).toEqual(
      [0, 1, 2].map(
        (i) =>
          `http://brouter:17777/brouter?lonlats=3.087,45.777|3.249,45.544&profile=gravel&alternativeidx=${i}&format=geojson`,
      ),
    );
  });

  it('never sends BRouter more calls at once than it has threads', async () => {
    let running = 0;
    let most = 0;
    const provider = new BRouterProvider(
      'http://b',
      async () => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return new Response(recorded);
      },
      2,
    );
    const [three, one] = await Promise.all([
      provider.route([A, B], 'road', [], 3),
      provider.route([A, B], 'road', [], 1),
    ]);
    expect(three).toHaveLength(3);
    expect(one).toHaveLength(1);
    expect(most).toBe(2);
  });

  it('leaves out an alternative the engine cannot find, but not the best route', async () => {
    const failing = (index: number) =>
      new BRouterProvider('http://b', async (url) =>
        url.includes(`alternativeidx=${index}`)
          ? new Response('no track found', { status: 400 })
          : new Response(recorded),
      );
    expect(await failing(2).route([A, B], 'road', [], 3)).toHaveLength(2);
    await expect(failing(0).route([A, B], 'road', [], 3)).rejects.toMatchObject(
      { code: 'no_route' },
    );
  });

  it('passes avoid zones to BRouter', async () => {
    let requested = '';
    const provider = new BRouterProvider(
      'http://brouter:17777',
      async (url) => {
        requested = url;
        return new Response(recorded);
      },
    );
    await provider.route(
      [A, B],
      'trail',
      [{ kind: 'circle', center: A, radiusMeters: 200 }],
      1,
    );
    expect(requested).toContain('profile=hiking-mountain');
    expect(requested).toContain('&nogos=3.087,45.777,200');
  });

  it('maps a BRouter 400 to no_route', async () => {
    const provider = new BRouterProvider(
      'http://b',
      respond('target island detected', 400),
    );
    await expect(provider.route([A, B], 'road', [], 1)).rejects.toMatchObject({
      code: 'no_route',
    });
  });

  it('maps a network failure to unavailable', async () => {
    const provider = new BRouterProvider('http://b', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(provider.route([A, B], 'road', [], 1)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('maps an unexpected body to provider_error', async () => {
    const provider = new BRouterProvider(
      'http://b',
      respond('<html>oops</html>'),
    );
    await expect(provider.route([A, B], 'road', [], 1)).rejects.toBeInstanceOf(
      RoutingError,
    );
  });

  it.each([
    [[A], 1],
    [[A, B], 0],
    [[A, B], 5],
  ])(
    'rejects invalid input (%j points, %i alternatives)',
    async (points, alternatives) => {
      const provider = new BRouterProvider('http://b', respond(recorded));
      await expect(
        provider.route(points, 'road', [], alternatives),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
    },
  );
});

describe('avoidZoneParams', () => {
  it('encodes circles, lines and polygons, several of each separated by |', () => {
    expect(
      avoidZoneParams([
        { kind: 'circle', center: A, radiusMeters: 100 },
        { kind: 'circle', center: B, radiusMeters: 50 },
        { kind: 'polyline', points: [A, B] },
        { kind: 'polygon', points: [A, B, { lon: 3, lat: 45 }] },
      ]),
    ).toBe(
      'nogos=3.087,45.777,100|3.249,45.544,50&polylines=3.087,45.777,3.249,45.544&polygons=3.087,45.777,3.249,45.544,3,45',
    );
  });

  it('is empty without zones', () => {
    expect(avoidZoneParams([])).toBe('');
  });

  describe('roundTrip', () => {
    /** A loop of a given length, as if BRouter had answered. */
    const loopOf = (meters: number, ascent = 100) =>
      JSON.stringify({
        features: [
          {
            properties: {
              'track-length': String(meters),
              'filtered ascend': String(ascent),
              'total-time': '3600',
            },
            geometry: {
              coordinates: [
                [3.087, 45.777, 400],
                [3.1, 45.8, 410],
                [3.087, 45.777, 400],
              ],
            },
          },
        ],
      });

    it('asks for a loop from the start, one direction per alternative', async () => {
      const urls: string[] = [];
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async (url) => {
          urls.push(url);
          return new Response(loopOf(30_000));
        },
      );
      const routes = await provider.roundTrip(A, 'gravel', [], 3, 30_000);
      expect(routes).toHaveLength(3);
      expect(urls.map((u) => /direction=(\d+)/.exec(u)?.[1])).toEqual([
        '0',
        '120',
        '240',
      ]);
      expect(urls[0]).toContain('lonlats=3.087,45.777&profile=gravel');
      expect(urls[0]).toContain('engineMode=4&roundTripDistance=5455');
    });

    it('corrects the radius until the loop is close to the asked length', async () => {
      const radii: number[] = [];
      const lengths = [50_000, 31_000];
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async (url) => {
          radii.push(Number(/roundTripDistance=(\d+)/.exec(url)?.[1]));
          return new Response(loopOf(lengths[radii.length - 1]));
        },
      );
      const [route] = await provider.roundTrip(A, 'road', [], 1, 30_000);
      expect(radii).toHaveLength(2);
      expect(radii[1]).toBeLessThan(radii[0]);
      expect(route.distanceMeters).toBe(31_000);
    });

    it('keeps the closest loop after the last try', async () => {
      const lengths = [60_000, 45_000, 50_000];
      let call = 0;
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async () => new Response(loopOf(lengths[call++])),
      );
      const [route] = await provider.roundTrip(A, 'road', [], 1, 30_000);
      expect(call).toBe(3);
      expect(route.distanceMeters).toBe(45_000);
    });

    it('cuts the spurs and corrects the radius on the length that is left', async () => {
      // About 4 km each way along a parallel (0.05 degree is 3.9 km at 45 N).
      const withSpur = (reported: number) =>
        JSON.stringify({
          features: [
            {
              properties: {
                'track-length': String(reported),
                'filtered ascend': '100',
                'total-time': '3600',
              },
              geometry: {
                coordinates: [
                  [3.0, 45.0, 400],
                  [3.0, 45.05, 400],
                  [3.05, 45.05, 400],
                  [3.0, 45.05, 400],
                  [3.0, 45.1, 400],
                  [3.1, 45.1, 400],
                  [3.0, 45.0, 400],
                ],
              },
            },
          ],
        });
      const radii: number[] = [];
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async (url) => {
          radii.push(Number(/roundTripDistance=(\d+)/.exec(url)?.[1]));
          return new Response(withSpur(30_000));
        },
      );
      const [route] = await provider.roundTrip(A, 'road', [], 1, 30_000);
      // The spur is gone from the geometry and from the length.
      expect(route.geometry).toHaveLength(5);
      expect(route.distanceMeters).toBeLessThan(30_000);
      // 30 km minus the spur is further than 10% from the target: the radius grew.
      expect(radii.length).toBeGreaterThan(1);
      expect(radii[1]).toBeGreaterThan(radii[0]);
    });

    it('tries more directions for a climb and keeps the loops that come closest', async () => {
      const directions: number[] = [];
      // The climb of the loop in each direction, in the order they are asked.
      const climbs = [100, 900, 400, 1200, 700, 300, 1000, 600];
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async (url) => {
          directions.push(Number(/direction=(\d+)/.exec(url)?.[1]));
          return new Response(
            loopOf(30_000, climbs[(directions.length - 1) % climbs.length]),
          );
        },
      );
      const routes = await provider.roundTrip(A, 'road', [], 2, 30_000, 1000);
      expect(directions).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
      expect(routes.map((route) => route.ascentMeters)).toEqual([1000, 900]);
    });

    it('keeps the loops close to a preferred heading', async () => {
      const directions: number[] = [];
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async (url) => {
          directions.push(Number(/direction=(\d+)/.exec(url)?.[1]));
          return new Response(loopOf(30_000, 500));
        },
      );
      const routes = await provider.roundTrip(
        A,
        'road',
        [],
        3,
        30_000,
        undefined,
        0,
      );
      // North, then a step on each side of it.
      expect(directions).toEqual([0, 25, 335]);
      expect(routes).toHaveLength(3);
    });

    it('looks for a climb around the preferred heading only', async () => {
      const directions: number[] = [];
      const climbs = [100, 900, 400, 1200, 700];
      const provider = new BRouterProvider(
        'http://brouter:17777',
        async (url) => {
          directions.push(Number(/direction=(\d+)/.exec(url)?.[1]));
          return new Response(
            loopOf(30_000, climbs[(directions.length - 1) % climbs.length]),
          );
        },
      );
      const routes = await provider.roundTrip(
        A,
        'road',
        [],
        1,
        30_000,
        1000,
        180,
      );
      expect(directions).toEqual([180, 205, 155, 230, 130]);
      expect(routes.map((route) => route.ascentMeters)).toEqual([900]);
    });

    it('rejects an unknown number of alternatives', async () => {
      const provider = new BRouterProvider(
        'http://brouter:17777',
        respond('x'),
      );
      await expect(
        provider.roundTrip(A, 'road', [], 9, 30_000),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });
  });
});
