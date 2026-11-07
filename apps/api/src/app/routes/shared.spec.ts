import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  type SharedRouteStore,
  createMemorySharedRoutes,
} from '../../db/shared-routes';
import { buildApp } from '../app';
import { loadConfig } from '../config';

const body = {
  name: 'Col de la Ventouse',
  profile: 'gravel',
  points: [
    [3.087, 45.777],
    [3.15, 45.65],
    [3.249, 45.544],
  ],
  geometry: [
    [3.087, 45.777, 402],
    [3.15, 45.65, 390.26],
    [3.249, 45.544, 380],
  ],
  distanceMeters: 41007,
  ascentMeters: 399,
  durationSeconds: 8674,
  createdAt: Date.parse('2026-11-01T10:00:00Z'),
};

const ID = 'abcdefghjk';

describe('shared routes', () => {
  let server: FastifyInstance;
  let store: ReturnType<typeof createMemorySharedRoutes>;
  let removeSpy: jest.SpyInstance;

  const start = async (env: NodeJS.ProcessEnv = {}) => {
    store = createMemorySharedRoutes();
    removeSpy = jest.spyOn(store as SharedRouteStore, 'remove');
    server = await buildApp({
      config: loadConfig(env),
      db: {
        ping: async () => true,
        close: async () => undefined,
        sharedRoutes: store,
      },
      routing: { name: 'fake', route: async () => [] },
    });
    await server.ready();
  };

  const put = (id: string, payload: unknown = body) =>
    server.inject({
      method: 'PUT',
      url: `/p/${id}`,
      payload: payload as object,
    });

  afterEach(async () => {
    await server.close();
  });

  describe('PUT /p/{id}', () => {
    it('creates the route and returns the delete token once', async () => {
      await start();
      const response = await put(ID);
      expect(response.statusCode).toBe(201);
      const created = response.json();
      expect(created.id).toBe(ID);
      expect(created.deleteToken).toMatch(/^[\w-]{43}$/);
      expect(store.size).toBe(1);
    });

    it('stores a hash of the token, never the token', async () => {
      await start();
      const { deleteToken } = (await put(ID)).json();
      // The store only knows the SHA-256 of the token: the token itself does not open it.
      expect(await store.remove(ID, deleteToken)).toBe('forbidden');
      const hash = createHash('sha256').update(deleteToken).digest('hex');
      expect(await store.remove(ID, hash)).toBe('deleted');
    });

    it('is immutable: an id already in use answers 409 and keeps the first route', async () => {
      await start();
      await put(ID);
      const again = await put(ID, { ...body, name: 'Other' });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('already_exists');
      expect((await store.get(ID))?.name).toBe('Col de la Ventouse');
    });

    it.each([
      ['an id with ambiguous characters', 'abcdefg0', body],
      ['an id that is too short', 'abc', body],
      ['no name', ID, { ...body, name: undefined }],
      ['an empty name', ID, { ...body, name: '' }],
      ['an unknown profile', ID, { ...body, profile: 'tank' }],
      ['a single point', ID, { ...body, points: [[3, 45]] }],
      [
        'a latitude out of range',
        ID,
        {
          ...body,
          points: [
            [3, 95],
            [3, 45],
          ],
        },
      ],
      ['an empty geometry', ID, { ...body, geometry: [] }],
      ['a negative distance', ID, { ...body, distanceMeters: -1 }],
      [
        '21 points',
        ID,
        { ...body, points: Array.from({ length: 21 }, () => [3, 45]) },
      ],
      [
        'too many geometry points',
        ID,
        { ...body, geometry: Array.from({ length: 5001 }, () => [3, 45, 400]) },
      ],
    ])(
      'rejects %s with the stable invalid_request code',
      async (_label, id, payload) => {
        await start();
        const response = await put(id, payload);
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe('invalid_request');
        expect(store.size).toBe(0);
      },
    );

    it('rejects a body above the limit with 413', async () => {
      await start({ SHARE_BODY_LIMIT_BYTES: '100' });
      const response = await put(ID);
      expect(response.statusCode).toBe(413);
      expect(response.json().code).toBe('payload_too_large');
    });

    it('throttles writes much harder than reads', async () => {
      await start({ SHARE_RATE_LIMIT_MAX: '2' });
      const statuses: number[] = [];
      for (const id of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) {
        statuses.push((await put(id)).statusCode);
      }
      expect(statuses).toEqual([201, 201, 429]);
      const read = await server.inject({ method: 'GET', url: '/p/aaaaaaaa' });
      expect(read.statusCode).toBe(200);
    });
  });

  describe('GET /p/{id}', () => {
    it('returns the route as it was shared, with the date it was shared', async () => {
      await start();
      await put(ID);
      const response = await server.inject({ method: 'GET', url: `/p/${ID}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ...body,
        id: ID,
        sharedAt: expect.any(Number),
      });
    });

    it('never exposes the delete token or its hash', async () => {
      await start();
      const { deleteToken } = (await put(ID)).json();
      const text = (await server.inject({ method: 'GET', url: `/p/${ID}` }))
        .body;
      expect(text).not.toContain(deleteToken);
      expect(text).not.toMatch(/token|hash/i);
    });

    it('answers 404 with a stable code for an unknown id', async () => {
      await start();
      const response = await server.inject({
        method: 'GET',
        url: '/p/zzzzzzzz',
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('not_found');
    });

    it('rejects a malformed id before touching the store', async () => {
      await start();
      const response = await server.inject({
        method: 'GET',
        url: '/p/ABCDEFGH',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('invalid_request');
    });
  });

  describe('GET /p/{id}.gpx', () => {
    it('returns the GPX, named after the route', async () => {
      await start();
      await put(ID);
      const response = await server.inject({
        method: 'GET',
        url: `/p/${ID}.gpx`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/gpx+xml');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="col-de-la-ventouse.gpx"',
      );
      expect(response.body).toContain('<gpx version="1.1"');
      expect(response.body).toContain(
        '<wpt lat="45.777000" lon="3.087000"><name>Start</name></wpt>',
      );
      expect(response.body).toContain('<name>Waypoint 1</name>');
      expect(response.body).toContain(
        '<trkpt lat="45.544000" lon="3.249000"><ele>380.0</ele></trkpt>',
      );
    });

    it('names the waypoints in the requested language', async () => {
      await start();
      await put(ID);
      const response = await server.inject({
        method: 'GET',
        url: `/p/${ID}.gpx?lang=fr`,
      });
      expect(response.body).toContain('<name>Départ</name>');
      expect(response.body).toContain('<name>Arrivée</name>');
    });

    it('is not mistaken for the JSON route', async () => {
      await start();
      await put(ID);
      const json = await server.inject({ method: 'GET', url: `/p/${ID}` });
      const gpx = await server.inject({ method: 'GET', url: `/p/${ID}.gpx` });
      expect(json.headers['content-type']).toContain('application/json');
      expect(gpx.headers['content-type']).toContain('application/gpx+xml');
    });

    it('answers 404 for an unknown id', async () => {
      await start();
      const response = await server.inject({
        method: 'GET',
        url: '/p/zzzzzzzz.gpx',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /p/{id}', () => {
    const del = (id: string, token?: string) =>
      server.inject({
        method: 'DELETE',
        url: `/p/${id}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });

    it('removes the route with the delete token', async () => {
      await start();
      const { deleteToken } = (await put(ID)).json();
      const response = await del(ID, deleteToken);
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(store.size).toBe(0);
      const read = await server.inject({ method: 'GET', url: `/p/${ID}` });
      expect(read.statusCode).toBe(404);
    });

    it('refuses without the token, or with another one, and keeps the route', async () => {
      await start();
      await put(ID);
      const missing = await del(ID);
      const wrong = await del(ID, 'x'.repeat(43));
      expect(missing.statusCode).toBe(403);
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json().code).toBe('forbidden');
      expect(store.size).toBe(1);
    });

    it('does not accept the token in the URL or the body', async () => {
      await start();
      const { deleteToken } = (await put(ID)).json();
      const response = await server.inject({
        method: 'DELETE',
        url: `/p/${ID}?token=${deleteToken}`,
      });
      expect(response.statusCode).toBe(403);
      expect(store.size).toBe(1);
    });

    it('answers 404 for an unknown id', async () => {
      await start();
      const response = await del('zzzzzzzz', 'whatever');
      expect(response.statusCode).toBe(404);
      expect(removeSpy).toHaveBeenCalled();
    });

    it('cannot be replayed once the route is gone', async () => {
      await start();
      const { deleteToken } = (await put(ID)).json();
      await del(ID, deleteToken);
      expect((await del(ID, deleteToken)).statusCode).toBe(404);
    });
  });

  it('documents the four operations in the OpenAPI document', async () => {
    await start();
    const spec = (
      await server.inject({ method: 'GET', url: '/openapi.json' })
    ).json();
    expect(spec.paths['/p/{id}']).toBeDefined();
    expect(Object.keys(spec.paths['/p/{id}']).sort()).toEqual([
      'delete',
      'get',
      'put',
    ]);
    expect(spec.paths['/p/{id}.gpx'].get.operationId).toBe('getSharedRouteGpx');
  });
});
