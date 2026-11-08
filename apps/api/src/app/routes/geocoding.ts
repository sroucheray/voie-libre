import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyError } from 'fastify';
import type { Geocoder } from '../../geocoding/geocoder';

export const MAX_QUERY_LENGTH = 200;
export const SEARCH_LIMIT = 6;

const Language = Type.Union([Type.Literal('en'), Type.Literal('fr')], {
  default: 'en',
});

const Place = Type.Object({
  label: Type.String(),
  lon: Type.Number(),
  lat: Type.Number(),
});

const SearchQuery = Type.Object({
  q: Type.String({ minLength: 2, maxLength: MAX_QUERY_LENGTH }),
  lang: Type.Optional(Language),
  lat: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
  lon: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
});

const SearchResponse = Type.Object({ places: Type.Array(Place) });

const ReverseQuery = Type.Object({
  lat: Type.Number({ minimum: -90, maximum: 90 }),
  lon: Type.Number({ minimum: -180, maximum: 180 }),
  lang: Type.Optional(Language),
});

const ReverseResponse = Type.Object({
  place: Type.Union([Place, Type.Null()], {
    description: 'The nearest address or place, null when there is none.',
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

export interface GeocodingOptions {
  geocoder: Geocoder;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export const geocodingRoutes: FastifyPluginAsyncTypebox<
  GeocodingOptions
> = async (fastify, { geocoder, rateLimitMax, rateLimitWindowMs }) => {
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if ('validation' in error && error.validation) {
      return reply
        .code(400)
        .send({ code: 'invalid_request', message: error.message });
    }
    throw error;
  });

  const config = {
    rateLimit: { max: rateLimitMax, timeWindow: rateLimitWindowMs },
  };

  fastify.get(
    '/geocode',
    {
      config,
      schema: {
        operationId: 'searchPlaces',
        tags: ['geocoding'],
        summary: 'Places and addresses matching a text',
        querystring: SearchQuery,
        response: { 200: SearchResponse, 400: ApiError, 503: ApiError },
      },
    },
    async (request, reply) => {
      const { q, lang = 'en', lat, lon } = request.query;
      const query = q.trim();
      if (query.length < 2) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'The query is too short.',
        });
      }
      try {
        const places = await geocoder.search(query, {
          lang,
          limit: SEARCH_LIMIT,
          near:
            lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
        });
        return { places };
      } catch (error) {
        request.log.error(error, 'geocoder failed');
        return reply.code(503).send({
          code: 'unavailable',
          message: 'The place search is not available.',
        });
      }
    },
  );

  fastify.get(
    '/geocode/reverse',
    {
      config,
      schema: {
        operationId: 'reverseGeocode',
        tags: ['geocoding'],
        summary: 'The address or place nearest to a position',
        querystring: ReverseQuery,
        response: { 200: ReverseResponse, 400: ApiError, 503: ApiError },
      },
    },
    async (request, reply) => {
      const { lat, lon, lang = 'en' } = request.query;
      try {
        return { place: await geocoder.reverse({ lat, lon }, { lang }) };
      } catch (error) {
        request.log.error(error, 'geocoder failed');
        return reply.code(503).send({
          code: 'unavailable',
          message: 'The place search is not available.',
        });
      }
    },
  );
};
