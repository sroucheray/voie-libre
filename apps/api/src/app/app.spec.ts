import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database';
import { buildApp } from './app';
import { loadConfig } from './config';

const fakeDb = (up: boolean): Database => ({
  ping: async () => up,
  close: async () => undefined,
});

describe('API', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  const start = async (up: boolean, env: NodeJS.ProcessEnv = {}) => {
    server = await buildApp({ config: loadConfig(env), db: fakeDb(up) });
    await server.ready();
  };

  it('GET /health reports api and database up', async () => {
    await start(true);
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      api: 'up',
      database: 'up',
    });
  });

  it('GET /health answers 503 when the database is down', async () => {
    await start(false);
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      api: 'up',
      database: 'down',
    });
  });

  it('serves the OpenAPI document with the health operation', async () => {
    await start(true);
    const response = await server.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/health'].get.operationId).toBe('getHealth');
    expect(spec.paths['/openapi.json']).toBeUndefined();
  });

  it('serves the documentation UI on /docs', async () => {
    await start(true);
    const response = await server.inject({ method: 'GET', url: '/docs/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('allows the configured origin through CORS only', async () => {
    await start(true, { CORS_ORIGINS: 'http://localhost:4200' });
    const allowed = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:4200' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:4200',
    );
    const denied = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits other routes but never /health', async () => {
    await start(true, { RATE_LIMIT_MAX: '2' });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push(
        (await server.inject({ method: 'GET', url: '/docs/json' })).statusCode,
      );
    }
    expect(codes).toContain(429);
    for (let i = 0; i < 4; i++) {
      expect(
        (await server.inject({ method: 'GET', url: '/health' })).statusCode,
      ).toBe(200);
    }
  });
});
