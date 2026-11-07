import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyError } from 'fastify';
import type { ElevationProvider } from '../../relief/elevation-provider';

export const MAX_ELEVATION_POINTS = 5000;

const Position = Type.Object({
  lon: Type.Number({ minimum: -180, maximum: 180 }),
  lat: Type.Number({ minimum: -90, maximum: 90 }),
});

const ElevationRequest = Type.Object({
  points: Type.Array(Position, {
    minItems: 1,
    maxItems: MAX_ELEVATION_POINTS,
  }),
});

const ElevationResponse = Type.Object({
  elevations: Type.Array(Type.Union([Type.Number(), Type.Null()]), {
    description:
      'Ground elevation in meters per point, in order; null where there is no data.',
  }),
});

/** Stable error body: the web app translates `code`, `message` is for developers. */
const ApiError = Type.Object({
  code: Type.Union([
    Type.Literal('invalid_request'),
    Type.Literal('unavailable'),
  ]),
  message: Type.String(),
});

export interface ElevationOptions {
  elevation: ElevationProvider;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export const elevationRoutes: FastifyPluginAsyncTypebox<
  ElevationOptions
> = async (fastify, { elevation, rateLimitMax, rateLimitWindowMs }) => {
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if ('validation' in error && error.validation) {
      return reply
        .code(400)
        .send({ code: 'invalid_request', message: error.message });
    }
    throw error;
  });

  fastify.post(
    '/elevation',
    {
      config: {
        rateLimit: { max: rateLimitMax, timeWindow: rateLimitWindowMs },
      },
      schema: {
        operationId: 'getElevations',
        tags: ['relief'],
        summary: 'Ground elevation of points, from local terrain data',
        body: ElevationRequest,
        response: { 200: ElevationResponse, 400: ApiError, 503: ApiError },
      },
    },
    async (request, reply) => {
      try {
        return { elevations: await elevation.elevations(request.body.points) };
      } catch (error) {
        request.log.error(error, 'elevation provider failed');
        return reply.code(503).send({
          code: 'unavailable',
          message: 'The elevation data could not be read.',
        });
      }
    },
  );
};
