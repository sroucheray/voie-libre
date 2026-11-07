import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from '../db/database';
import type { RoutingProvider } from '../routing/routing-provider';
import type { Config } from './config';
import { healthRoutes } from './routes/health';
import { routeRoutes } from './routes/route';
import { sharedRoutes } from './routes/shared';

export interface AppOptions {
  config: Config;
  db: Database;
  routing: RoutingProvider;
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
  logger = false,
}: AppOptions): Promise<FastifyInstance> {
  const fastify = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

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
  await fastify.register(sharedRoutes, {
    store: db.sharedRoutes,
    writeRateLimitMax: config.shareRateLimitMax,
    writeRateLimitWindowMs: config.shareRateLimitWindowMs,
    bodyLimitBytes: config.shareBodyLimitBytes,
  });
  return fastify;
}
