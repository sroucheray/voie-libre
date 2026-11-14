import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from '../db/database';
import type { Geocoder } from '../geocoding/geocoder';
import type { ElevationProvider } from '../relief/elevation-provider';
import type { RoutingProvider } from '../routing/routing-provider';
import type { Config } from './config';
import { healthRoutes } from './routes/health';
import { routeRoutes } from './routes/route';
import { elevationRoutes } from './routes/elevation';
import { geocodingRoutes } from './routes/geocoding';
import { sharedRoutes } from './routes/shared';
import { statsRoutes } from './routes/stats';
import { createMemoryStats } from '../db/stats';

export interface AppOptions {
  config: Config;
  db: Database;
  routing: RoutingProvider;
  /** Without one, every elevation is unknown (`null`): useful in tests. */
  elevation?: ElevationProvider;
  /** Without one, every search finds nothing: useful in tests. */
  geocoder?: Geocoder;
  logger?: boolean | { level: string };
}

/**
 * Builds the Fastify app. Plugin order matters: @fastify/swagger must be registered
 * before the routes it documents.
 */
export async function buildApp({
  config,
  db,
  routing,
  elevation = { elevations: async (points) => points.map(() => null) },
  geocoder = {
    name: 'none',
    search: async () => [],
    reverse: async () => null,
  },
  logger = false,
}: AppOptions): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger,
    trustProxy: config.trustProxy,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await fastify.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  });
  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Voie Libre API',
        description: 'Route planning API for road, gravel and trail.',
        version: '0.0.0',
        license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      },
      tags: [
        { name: 'system', description: 'Health and diagnostics' },
        { name: 'routing', description: 'Route computation' },
        { name: 'geocoding', description: 'Place and address search' },
        { name: 'stats', description: 'Aggregated audience counters' },
        {
          name: 'sharing',
          description: 'Routes shared by link, without an account',
        },
      ],
    },
  });
  await fastify.register(swaggerUi, { routePrefix: '/docs' });

  fastify.get(
    '/openapi.json',
    { config: { rateLimit: false }, schema: { hide: true } },
    async () => fastify.swagger(),
  );

  await fastify.register(healthRoutes, { db });
  await fastify.register(routeRoutes, {
    routing,
    rateLimitMax: config.routeRateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  await fastify.register(elevationRoutes, {
    elevation,
    rateLimitMax: config.elevationRateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  await fastify.register(geocodingRoutes, {
    geocoder,
    rateLimitMax: config.geocodeRateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  await fastify.register(sharedRoutes, {
    store: db.sharedRoutes,
    writeRateLimitMax: config.shareRateLimitMax,
    writeRateLimitWindowMs: config.shareRateLimitWindowMs,
    bodyLimitBytes: config.shareBodyLimitBytes,
  });
  await fastify.register(statsRoutes, {
    store: db.stats ?? createMemoryStats(),
    rateLimitMax: config.statsRateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  return fastify;
}
