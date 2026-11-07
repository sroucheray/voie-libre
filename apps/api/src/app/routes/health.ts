import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Database } from '../../db/database';

const Health = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  api: Type.Literal('up'),
  database: Type.Union([Type.Literal('up'), Type.Literal('down')]),
});

export interface HealthOptions {
  db: Database;
}

export const healthRoutes: FastifyPluginAsyncTypebox<HealthOptions> = async (
  fastify,
  { db },
) => {
  fastify.get(
    '/health',
    {
      // Probes (Docker, load balancers) must never be throttled.
      config: { rateLimit: false },
      schema: {
        operationId: 'getHealth',
        tags: ['system'],
        summary: 'State of the API and of its database',
        response: {
          200: Health,
          503: Health,
        },
      },
    },
    async (_request, reply) => {
      const database = (await db.ping()) ? 'up' : 'down';
      const status = database === 'up' ? 'ok' : 'degraded';
      return reply
        .code(database === 'up' ? 200 : 503)
        .send({ status, api: 'up', database });
    },
  );
};
