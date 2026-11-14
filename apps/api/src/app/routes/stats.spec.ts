import type { FastifyInstance } from 'fastify';
import { createMemoryStats } from '../../db/stats';
import { buildApp } from '../app';
import { loadConfig } from '../config';

describe('POST /stats', () => {
  let server: FastifyInstance;
  let stats: ReturnType<typeof createMemoryStats>;

  beforeEach(async () => {
    stats = createMemoryStats();
    server = await buildApp({
      config: loadConfig({}),
      db: {
        ping: async () => true,
        close: async () => undefined,
        stats,
        sharedRoutes: {} as never,
      },
      routing: { name: 'fake', route: async () => [] },
    });
    await server.ready();
  });
  afterEach(() => server.close());

  const post = (
    payload: unknown,
    headers: Record<string, string> = { 'user-agent': 'a' },
  ) =>
    server.inject({
      method: 'POST',
      url: '/stats',
      payload: payload as object,
      headers,
    });
  const get = (metric: string, dimension = 'all') =>
    stats.rows().find((r) => r.metric === metric && r.dimension === dimension);

  it('counts a visit, its language and device, and a visitor once a day', async () => {
    const visit = { event: 'visit', language: 'fr', device: 'phone' };
    expect((await post(visit)).statusCode).toBe(204);
    await post(visit);
    expect(get('visit')?.count).toBe(2);
    expect(get('visit_language', 'fr')?.count).toBe(2);
    expect(get('visit_device', 'phone')?.count).toBe(2);
    expect(get('unique')?.count).toBe(1);
    await post(visit, { 'user-agent': 'b' });
    expect(get('unique')?.count).toBe(2);
  });

  it('sums the kilometres, points and stops of the routes, with a distance band', async () => {
    await post({
      event: 'route',
      profile: 'gravel',
      kilometers: 30,
      points: 3,
      stops: 1,
    });
    await post({
      event: 'route',
      profile: 'gravel',
      kilometers: 120,
      points: 5,
      stops: 3,
    });
    expect(get('route', 'gravel')).toMatchObject({ count: 2, total: 150 });
    expect(get('route_distance', '20-50')?.count).toBe(1);
    expect(get('route_distance', '100-200')?.count).toBe(1);
    expect(get('route_points')).toMatchObject({ count: 2, total: 8 });
    expect(get('route_stops')).toMatchObject({ count: 2, total: 4 });
  });

  it('counts the other events and refuses anything else', async () => {
    await post({ event: 'export_gpx' });
    expect(get('export_gpx')?.count).toBe(1);
    expect((await post({ event: 'search' })).statusCode).toBe(400);
    // An unknown field is dropped by the validation, never stored.
    await post({ event: 'export_fit', place: 'Angers' });
    expect(JSON.stringify(stats.rows())).not.toContain('Angers');
    expect(stats.rows()).toHaveLength(2);
  });

  it('stores no address or user-agent', async () => {
    await post({ event: 'visit' }, { 'user-agent': 'SecretAgent/1' });
    expect(JSON.stringify(stats.rows())).not.toMatch(/SecretAgent|127\.0/);
  });

  it('ignores Do Not Track and Global Privacy Control', async () => {
    expect((await post({ event: 'visit' }, { dnt: '1' })).statusCode).toBe(204);
    expect(
      (await post({ event: 'visit' }, { 'sec-gpc': '1' })).statusCode,
    ).toBe(204);
    expect(stats.rows()).toHaveLength(0);
  });

  it('removes the days before a date', async () => {
    await stats.add('2025-01-01', [
      { metric: 'visit', dimension: 'all', count: 1, total: 0 },
    ]);
    expect(await stats.deleteBefore('2025-02-01')).toBe(1);
  });
});
