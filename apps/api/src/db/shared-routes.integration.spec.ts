import { Pool } from 'pg';
import { loadConfig } from '../app/config';
import {
  type NewSharedRoute,
  createPostgresSharedRoutes,
} from './shared-routes';

/**
 * Runs against the real PostgreSQL/PostGIS with the migrations applied. Opt-in:
 *   docker compose up -d db && npm run db:migrate && DATABASE_INTEGRATION=1 npx nx test api -- integration
 */
const run = process.env['DATABASE_INTEGRATION'] ? describe : describe.skip;

const route: NewSharedRoute = {
  id: 'itestaaaa',
  name: 'Integration',
  profile: 'trail',
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  geometry: [
    [3.087, 45.777, 402],
    [3.15, 45.65, 390.5],
    [3.249, 45.544, 380],
  ],
  distanceMeters: 41007.5,
  ascentMeters: 399,
  durationSeconds: 8674,
  createdAt: Date.parse('2026-11-01T10:00:00.123Z'),
};

run('PostgreSQL shared routes', () => {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  const store = createPostgresSharedRoutes(pool);

  beforeEach(async () => {
    await pool.query('DELETE FROM shared_routes WHERE id LIKE $1', ['itest%']);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM shared_routes WHERE id LIKE $1', ['itest%']);
    await pool.end();
  });

  it('stores the itinerary as a PostGIS line and reads it back unchanged', async () => {
    expect(await store.create(route, 'hash-1')).toBe(true);
    const read = await store.get(route.id);
    expect(read).toEqual({ ...route, sharedAt: expect.any(Number) });
    const { rows } = await pool.query(
      'SELECT ST_GeometryType(geometry) AS type, ST_NumPoints(geometry) AS n, ST_SRID(geometry) AS srid FROM shared_routes WHERE id = $1',
      [route.id],
    );
    expect(rows[0]).toEqual({ type: 'ST_LineString', n: 3, srid: 4326 });
  });

  it('refuses a second route under the same id', async () => {
    await store.create(route, 'hash-1');
    expect(await store.create({ ...route, name: 'Other' }, 'hash-2')).toBe(
      false,
    );
    expect((await store.get(route.id))?.name).toBe('Integration');
  });

  it('returns null for an unknown id', async () => {
    expect(await store.get('itestzzzz')).toBeNull();
  });

  it('removes only with the matching token hash', async () => {
    await store.create(route, 'hash-1');
    expect(await store.remove(route.id, 'other')).toBe('forbidden');
    expect(await store.get(route.id)).not.toBeNull();
    expect(await store.remove(route.id, 'hash-1')).toBe('deleted');
    expect(await store.remove(route.id, 'hash-1')).toBe('not_found');
  });

  it('refuses an id that breaks the table constraint', async () => {
    await expect(
      store.create({ ...route, id: 'ITESTAAAA' }, 'h'),
    ).rejects.toThrow();
  });
});
