import type { FastifyInstance } from 'fastify';
import { createMemorySharedRoutes } from '../../db/shared-routes';
import { type Geocoder, GeocodingError } from '../../geocoding/geocoder';
import { buildApp } from '../app';
import { loadConfig } from '../config';

describe('geocoding routes', () => {
  let server: FastifyInstance;
  let geocoder: { name: string; search: jest.Mock; reverse: jest.Mock };

  const start = async (env: NodeJS.ProcessEnv = {}) => {
    geocoder = {
      name: 'fake',
      search: jest.fn(async () => [
        { label: 'Gare de Lyon, Paris', lon: 2.37, lat: 48.84 },
      ]),
      reverse: jest.fn(async () => ({
        label: 'Rue de Bercy, Paris',
        lon: 2.37,
        lat: 48.84,
      })),
    };
    server = await buildApp({
      config: loadConfig(env),
      db: {
        ping: async () => true,
        close: async () => undefined,
        sharedRoutes: createMemorySharedRoutes(),
      },
      routing: { name: 'fake', route: jest.fn() },
      geocoder: geocoder as Geocoder,
    });
    await server.ready();
  };

  afterEach(async () => {
    await server.close();
  });

  it('searches places, trimming the text and passing language and bias', async () => {
    await start();
    const response = await server.inject({
      method: 'GET',
      url: '/geocode?q=%20gare%20de%20lyon%20&lang=fr&lat=48.8&lon=2.3',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      places: [{ label: 'Gare de Lyon, Paris', lon: 2.37, lat: 48.84 }],
    });
    expect(geocoder.search).toHaveBeenCalledWith('gare de lyon', {
      lang: 'fr',
      limit: 6,
      near: { lat: 48.8, lon: 2.3 },
    });
  });

  it('rejects a missing, short or too long query with invalid_request', async () => {
    await start();
    for (const url of [
      '/geocode',
      '/geocode?q=a',
      '/geocode?q=%20%20a%20%20',
      `/geocode?q=${'x'.repeat(201)}`,
      '/geocode?q=paris&lang=de',
    ]) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('invalid_request');
    }
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it('answers 503 unavailable when the geocoder fails', async () => {
    await start();
    geocoder.search.mockRejectedValue(
      new GeocodingError('unavailable', 'down'),
    );
    const response = await server.inject({
      method: 'GET',
      url: '/geocode?q=paris',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('unavailable');
  });

  it('reverses a position, with null when nothing is around', async () => {
    await start();
    const found = await server.inject({
      method: 'GET',
      url: '/geocode/reverse?lat=48.84&lon=2.37',
    });
    expect(found.json()).toEqual({
      place: { label: 'Rue de Bercy, Paris', lon: 2.37, lat: 48.84 },
    });
    expect(geocoder.reverse).toHaveBeenCalledWith(
      { lat: 48.84, lon: 2.37 },
      { lang: 'en' },
    );
    geocoder.reverse.mockResolvedValue(null);
    const none = await server.inject({
      method: 'GET',
      url: '/geocode/reverse?lat=0&lon=0',
    });
    expect(none.json()).toEqual({ place: null });
    const bad = await server.inject({
      method: 'GET',
      url: '/geocode/reverse?lat=95&lon=0',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('is rate limited', async () => {
    await start({ GEOCODE_RATE_LIMIT_MAX: '2' });
    const get = () => server.inject({ method: 'GET', url: '/geocode?q=paris' });
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(429);
  });
});
