import type { FastifyInstance } from 'fastify';
import { createMemorySharedRoutes } from '../../db/shared-routes';
import type { ElevationProvider } from '../../relief/elevation-provider';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { MAX_ELEVATION_POINTS } from './elevation';

describe('POST /elevation', () => {
  let server: FastifyInstance;
  let elevations: jest.Mock;

  const start = async (env: NodeJS.ProcessEnv = {}) => {
    elevations = jest.fn(async (points: unknown[]) => points.map(() => 123.4));
    const elevation: ElevationProvider = { elevations };
    server = await buildApp({
      config: loadConfig(env),
      db: {
        ping: async () => true,
        close: async () => undefined,
        sharedRoutes: createMemorySharedRoutes(),
      },
      routing: { name: 'fake', route: jest.fn() },
      elevation,
    });
    await server.ready();
  };

  const post = (payload: unknown) =>
    server.inject({
      method: 'POST',
      url: '/elevation',
      payload: payload as object,
    });

  afterEach(async () => {
    await server.close();
  });

  it('returns one elevation per point, null where there is no data', async () => {
    await start();
    elevations.mockResolvedValueOnce([402.5, null]);
    const response = await post({
      points: [
        { lon: 3.087, lat: 45.777 },
        { lon: 40, lat: 10 },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ elevations: [402.5, null] });
    expect(elevations).toHaveBeenCalledWith([
      { lon: 3.087, lat: 45.777 },
      { lon: 40, lat: 10 },
    ]);
  });

  it.each([
    ['no point', { points: [] }],
    ['a bad latitude', { points: [{ lon: 3, lat: 95 }] }],
    ['a missing field', { points: [{ lon: 3 }] }],
    [
      'too many points',
      {
        points: Array.from({ length: MAX_ELEVATION_POINTS + 1 }, () => ({
          lon: 3,
          lat: 45,
        })),
      },
    ],
  ])('rejects %s with a stable code', async (_name, payload) => {
    await start();
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_request');
    expect(elevations).not.toHaveBeenCalled();
  });

  it('answers 503 when the data cannot be read', async () => {
    await start();
    elevations.mockRejectedValueOnce(new Error('disk'));
    const response = await post({ points: [{ lon: 3, lat: 45 }] });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('unavailable');
  });

  it('is rate limited', async () => {
    await start({ ELEVATION_RATE_LIMIT_MAX: '2' });
    const body = { points: [{ lon: 3, lat: 45 }] };
    expect((await post(body)).statusCode).toBe(200);
    expect((await post(body)).statusCode).toBe(200);
    expect((await post(body)).statusCode).toBe(429);
  });
});
