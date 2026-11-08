import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyError } from 'fastify';
import {
  MAX_ALTERNATIVES,
  ROUTING_PROFILES,
  RoutingError,
  type RoutingErrorCode,
  type RoutingProvider,
} from '../../routing/routing-provider';
import { routeLoop } from '../../routing/loops';

const Position = Type.Object({
  lon: Type.Number({ minimum: -180, maximum: 180 }),
  lat: Type.Number({ minimum: -90, maximum: 90 }),
});

const MAX_POINTS = 20;
const MAX_ZONES = 20;
const MAX_ZONE_POINTS = 100;

const AvoidZone = Type.Union([
  Type.Object({
    kind: Type.Literal('circle'),
    center: Position,
    radiusMeters: Type.Number({ exclusiveMinimum: 0, maximum: 50_000 }),
  }),
  Type.Object({
    kind: Type.Literal('polyline'),
    points: Type.Array(Position, { minItems: 2, maxItems: MAX_ZONE_POINTS }),
  }),
  Type.Object({
    kind: Type.Literal('polygon'),
    points: Type.Array(Position, { minItems: 3, maxItems: MAX_ZONE_POINTS }),
  }),
]);

const MIN_LOOP_METERS = 2_000;
const MAX_LOOP_METERS = 200_000;
const MAX_LOOP_ASCENT_METERS = 10_000;

const LoopRequest = Type.Union(
  [
    Type.Object({
      mode: Type.Literal('avoid_outbound'),
    }),
    Type.Object({
      mode: Type.Literal('distance'),
      distanceMeters: Type.Number({
        minimum: MIN_LOOP_METERS,
        maximum: MAX_LOOP_METERS,
      }),
      ascentMeters: Type.Optional(
        Type.Number({
          minimum: 0,
          maximum: MAX_LOOP_ASCENT_METERS,
          description:
            'Climb the loop should come close to. Approached by trying several directions, not guaranteed.',
        }),
      ),
    }),
  ],
  {
    description:
      'Closes the route. `avoid_outbound`: points go out and end on the start, the way back avoids the way out where it can. `distance`: points are the start twice, the engine draws a loop of about this length, and of about `ascentMeters` of climb if given (alternatives head in different directions).',
  },
);

const RouteRequest = Type.Object({
  points: Type.Array(Position, {
    minItems: 2,
    maxItems: MAX_POINTS,
    description: 'Start, optional waypoints, end, in order.',
  }),
  profile: Type.Union(ROUTING_PROFILES.map((profile) => Type.Literal(profile))),
  avoidZones: Type.Optional(
    Type.Array(AvoidZone, { maxItems: MAX_ZONES, default: [] }),
  ),
  loop: Type.Optional(LoopRequest),
  alternatives: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_ALTERNATIVES,
      default: 1,
      description: 'Number of routes to return; the first is the best.',
    }),
  ),
});

const Route = Type.Object({
  geometry: Type.Array(
    Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
    {
      description: '[longitude, latitude, elevation in meters] per point.',
    },
  ),
  distanceMeters: Type.Number(),
  ascentMeters: Type.Number(),
  durationSeconds: Type.Number(),
});

const RouteResponse = Type.Object({ routes: Type.Array(Route) });

/** Stable error body: the web app translates `code`, `message` is for developers. */
const ApiError = Type.Object({
  code: Type.Union([
    Type.Literal('invalid_request'),
    Type.Literal('no_route'),
    Type.Literal('unavailable'),
    Type.Literal('provider_error'),
  ]),
  message: Type.String(),
});

const STATUS: Record<RoutingErrorCode, 400 | 422 | 502 | 503> = {
  invalid_request: 400,
  no_route: 422,
  provider_error: 502,
  unavailable: 503,
};

export interface RouteOptions {
  routing: RoutingProvider;
  /** Requests per window per client: routing is the expensive endpoint. */
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export const routeRoutes: FastifyPluginAsyncTypebox<RouteOptions> = async (
  fastify,
  { routing, rateLimitMax, rateLimitWindowMs },
) => {
  // Scoped to this plugin: schema validation failures use the same error body.
  fastify.setErrorHandler(
    (error: FastifyError | RoutingError, _request, reply) => {
      if (error instanceof RoutingError) {
        return reply
          .code(STATUS[error.code])
          .send({ code: error.code, message: error.message });
      }
      if ('validation' in error && error.validation) {
        return reply
          .code(400)
          .send({ code: 'invalid_request', message: error.message });
      }
      throw error;
    },
  );

  fastify.post(
    '/route',
    {
      config: {
        rateLimit: { max: rateLimitMax, timeWindow: rateLimitWindowMs },
      },
      schema: {
        operationId: 'computeRoute',
        tags: ['routing'],
        summary: 'Compute a route between points, with optional alternatives',
        body: RouteRequest,
        response: {
          200: RouteResponse,
          400: ApiError,
          422: ApiError,
          502: ApiError,
          503: ApiError,
        },
      },
    },
    async (request) => {
      const {
        points,
        profile,
        avoidZones = [],
        alternatives = 1,
        loop,
      } = request.body;
      if (loop) {
        return {
          routes: await routeLoop(
            routing,
            points,
            profile,
            avoidZones,
            alternatives,
            loop,
          ),
        };
      }
      return {
        routes: await routing.route(points, profile, avoidZones, alternatives),
      };
    },
  );
};
