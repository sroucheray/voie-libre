import type { FastifyInstance } from 'fastify';
import {
  type RouteResult,
  RoutingError,
  type RoutingProvider,
} from '../../routing/routing-provider';
import { createMemorySharedRoutes } from '../../db/shared-routes';
import { buildApp } from '../app';
import { loadConfig } from '../config';

const A = { lon: 3.087, lat: 45.777 };
const B = { lon: 3.249, lat: 45.544 };

const result: RouteResult = {
  geometry: [
    [3.087, 45.777, 402],
    [3.249, 45.544, 380],
  ],
  distanceMeters: 41007,
  ascentMeters: 399,
  durationSeconds: 8674,
};

describe('POST /route', () => {
  let server: FastifyInstance;
  let route: jest.Mock;

  const start = async (env: NodeJS.ProcessEnv = {}) => {
    route = jest.fn().mockResolvedValue([result]);
    const routing: RoutingProvider = { name: 'fake', route };
    server = await buildApp({
      config: loadConfig(env),
      db: {
        ping: async () => true,
        close: async () => undefined,
        sharedRoutes: createMemorySharedRoutes(),
      },
      routing,
    });
    await server.ready();
  };

  const post = (payload: unknown) =>
    server.inject({
      method: 'POST',
      url: '/route',
      payload: payload as object,
    });

  afterEach(async () => {
    await server.close();
  });

  describe('loop', () => {
    it('goes through the loop logic and keeps the same response shape', async () => {
      await start();
      const response = await post({
        points: [A, B, A],
        profile: 'road',
        loop: { mode: 'avoid_outbound' },
      });
      expect(response.statusCode).toBe(200);
      // Way out, then way back: two calls to the provider, one route joined.
      expect(route).toHaveBeenCalledTimes(2);
      expect(response.json().routes).toHaveLength(1);
    });

    it('asks the provider for a round trip by distance', async () => {
      await start();
      const roundTrip = jest.fn().mockResolvedValue([result]);
      const routing: RoutingProvider = { name: 'fake', route, roundTrip };
      await server.close();
      server = await buildApp({
        config: loadConfig({}),
        db: {
          ping: async () => true,
          close: async () => undefined,
          sharedRoutes: createMemorySharedRoutes(),
        },
        routing,
      });
      await server.ready();
      const response = await post({
        points: [A, A],
        profile: 'gravel',
        alternatives: 2,
        loop: { mode: 'distance', distanceMeters: 30000 },
      });
      expect(response.statusCode).toBe(200);
      expect(roundTrip).toHaveBeenCalledWith(
        A,
        'gravel',
        [],
        2,
        30000,
        undefined,
      );
    });

    it.each([
      ['an unknown mode', { mode: 'spiral' }],
      ['a loop that is too short', { mode: 'distance', distanceMeters: 500 }],
      ['a loop that is too long', { mode: 'distance', distanceMeters: 900000 }],
    ])('rejects %s with a stable code', async (_name, loop) => {
      await start();
      const response = await post({ points: [A, A], profile: 'road', loop });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('invalid_request');
    });

    it('refuses a loop by distance with extra points', async () => {
      await start();
      const response = await post({
        points: [A, B],
        profile: 'road',
        loop: { mode: 'distance', distanceMeters: 30000 },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  it('returns the computed routes, with default zones and one alternative', async () => {
    await start();
    const response = await post({ points: [A, B], profile: 'road' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ routes: [result] });
    expect(route).toHaveBeenCalledWith([A, B], 'road', [], 1);
  });

  it('passes profile, avoid zones and alternatives to the provider', async () => {
    await start();
    const zone = { kind: 'circle', center: A, radiusMeters: 200 };
    await post({
      points: [A, B],
      profile: 'trail',
      avoidZones: [zone],
      alternatives: 3,
    });
    expect(route).toHaveBeenCalledWith([A, B], 'trail', [zone], 3);
  });

  it.each([
    ['a single point', { points: [A], profile: 'road' }],
    ['an unknown profile', { points: [A, B], profile: 'car' }],
    [
      'too many alternatives',
      { points: [A, B], profile: 'road', alternatives: 5 },
    ],
    [
      'an out-of-range latitude',
      { points: [A, { lon: 3, lat: 91 }], profile: 'road' },
    ],
    [
      'a polygon with two points',
      {
        points: [A, B],
        profile: 'road',
        avoidZones: [{ kind: 'polygon', points: [A, B] }],
      },
    ],
    ['a missing profile', { points: [A, B] }],
  ])('rejects %s with invalid_request', async (_name, payload) => {
    await start();
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_request');
    expect(route).not.toHaveBeenCalled();
  });

  it.each([
    ['no_route', 422],
    ['unavailable', 503],
    ['provider_error', 502],
    ['invalid_request', 400],
  ] as const)('maps a %s routing error to HTTP %i', async (code, status) => {
    await start();
    route.mockRejectedValue(new RoutingError(code, 'details'));
    const response = await post({ points: [A, B], profile: 'road' });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, message: 'details' });
  });

  it('documents the operation in the OpenAPI spec', async () => {
    await start();
    const spec = (
      await server.inject({ method: 'GET', url: '/openapi.json' })
    ).json();
    expect(spec.paths['/route'].post.operationId).toBe('computeRoute');
  });

  it('applies the stricter route rate limit', async () => {
    await start({ ROUTE_RATE_LIMIT_MAX: '2' });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await post({ points: [A, B], profile: 'road' })).statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
  });
});
