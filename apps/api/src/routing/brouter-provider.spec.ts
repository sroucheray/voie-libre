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
});
