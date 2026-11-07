import { buildApp } from '../app/app';
import { createMemorySharedRoutes } from '../db/shared-routes';
import { loadConfig } from '../app/config';
import { BRouterProvider } from './brouter-provider';
import { routeLoop } from './loops';

/**
 * Runs against a real BRouter with the E0_N45 segment (Clermont-Ferrand). Opt-in:
 *   docker compose up -d brouter && BROUTER_INTEGRATION=1 npx nx test api -- integration
 */
const run = process.env['BROUTER_INTEGRATION'] ? describe : describe.skip;

const clermont = { lon: 3.087, lat: 45.777 };
const issoire = { lon: 3.249, lat: 45.544 };

run('BRouter integration', () => {
  const provider = new BRouterProvider(loadConfig().brouterUrl);

  it('routes Clermont-Ferrand to Issoire with three distinct alternatives', async () => {
    const routes = await provider.route([clermont, issoire], 'gravel', [], 3);
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect(route.distanceMeters).toBeGreaterThan(35_000);
      expect(route.distanceMeters).toBeLessThan(60_000);
      expect(route.ascentMeters).toBeGreaterThan(0);
      expect(route.geometry[0][2]).toBeGreaterThan(0);
    }
    expect(new Set(routes.map((r) => r.distanceMeters)).size).toBeGreaterThan(
      1,
    );
  });

  it('goes around a circle placed on the first route', async () => {
    const [first] = await provider.route([clermont, issoire], 'road', [], 1);
    const [lon, lat] = first.geometry[Math.floor(first.geometry.length / 2)];
    const [detour] = await provider.route(
      [clermont, issoire],
      'road',
      [{ kind: 'circle', center: { lon, lat }, radiusMeters: 200 }],
      1,
    );
    expect(detour.distanceMeters).not.toBe(first.distanceMeters);
  });

  it('answers through POST /route', async () => {
    const server = await buildApp({
      config: loadConfig(),
      db: {
        ping: async () => true,
        close: async () => undefined,
        sharedRoutes: createMemorySharedRoutes(),
      },
      routing: provider,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/route',
      payload: { points: [clermont, issoire], profile: 'trail' },
    });
    await server.close();
    expect(response.statusCode).toBe(200);
    expect(response.json().routes[0].geometry.length).toBeGreaterThan(100);
  });

  it('reports no_route for a point far outside the loaded segment', async () => {
    await expect(
      provider.route([clermont, { lon: -40, lat: 30 }], 'road', [], 1),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/no_route|provider_error/),
    });
  });

  it('draws loops of about the asked length, heading different ways', async () => {
    const routes = await provider.roundTrip(clermont, 'road', [], 2, 30_000);
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      expect(route.distanceMeters).toBeGreaterThan(24_000);
      expect(route.distanceMeters).toBeLessThan(36_000);
      const first = route.geometry[0];
      const last = route.geometry[route.geometry.length - 1];
      expect(Math.abs(first[0] - last[0])).toBeLessThan(0.001);
      expect(Math.abs(first[1] - last[1])).toBeLessThan(0.001);
    }
  }, 60_000);

  it('comes back by other roads when asked to avoid the way out', async () => {
    const [loop] = await routeLoop(
      provider,
      [clermont, issoire, clermont],
      'road',
      [],
      1,
      { mode: 'avoid_outbound' },
    );
    const [plain] = await provider.route([clermont, issoire], 'road', [], 1);
    const key = (c: number[]) => `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
    const out = new Set(plain.geometry.map(key));
    const way = loop.geometry.slice(plain.geometry.length);
    const shared = way.filter((c) => out.has(key(c))).length / way.length;
    expect(shared).toBeLessThan(0.3);
  }, 60_000);
});
