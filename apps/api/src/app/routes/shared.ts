import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyError } from 'fastify';
import {
  GPX_LANGUAGES,
  ROUTE_ID_PATTERN,
  buildGpx,
  gpxFileName,
  gpxPointNames,
  type GpxLanguage,
} from '@voie-libre/shared';
import type { SharedRouteStore } from '../../db/shared-routes';

const MAX_POINTS = 20;
/**
 * A route of a few hundred km, with a point every 10 m or so. 5000 was far too few: a ride
 * of 60 km is refused. About 35 bytes a point in JSON, so the body limit (2 MB) is what
 * really stops a request at this size.
 */
const MAX_GEOMETRY_POINTS = 50_000;

const Position = Type.Tuple([
  Type.Number({ minimum: -180, maximum: 180 }),
  Type.Number({ minimum: -90, maximum: 90 }),
]);

const RouteId = Type.String({ pattern: ROUTE_ID_PATTERN });
const IdParams = Type.Object({ id: RouteId });

const Metric = Type.Number({ minimum: 0, maximum: 1e9 });

/** How long a shared route is kept, in the words of the choice offered to the person. */
export const LIFETIMES_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const;

const Lifetime = Type.Union(
  [Type.Literal('day'), Type.Literal('week'), Type.Literal('month')],
  {
    description:
      'How long the route is kept: one day, one week or one month. After that it is removed.',
  },
);

const SharedRouteBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  profile: Type.Union([
    Type.Literal('road'),
    Type.Literal('gravel'),
    Type.Literal('trail'),
  ]),
  points: Type.Array(Position, {
    minItems: 2,
    maxItems: MAX_POINTS,
    description:
      'Start, optional waypoints, end, in order: [longitude, latitude].',
  }),
  geometry: Type.Array(
    Type.Tuple([
      Type.Number({ minimum: -180, maximum: 180 }),
      Type.Number({ minimum: -90, maximum: 90 }),
      Type.Number({ minimum: -1000, maximum: 10_000 }),
    ]),
    {
      minItems: 2,
      maxItems: MAX_GEOMETRY_POINTS,
      description: '[longitude, latitude, elevation in meters] per point.',
    },
  ),
  distanceMeters: Metric,
  ascentMeters: Metric,
  durationSeconds: Metric,
  createdAt: Type.Integer({
    minimum: 0,
    maximum: 8_640_000_000_000_000,
    description:
      'When the route was saved on the device, in milliseconds since the epoch.',
  }),
});

const SharedRouteResponse = Type.Object({
  ...SharedRouteBody.properties,
  id: RouteId,
  sharedAt: Type.Integer({
    description: 'When the route reached the server, in milliseconds.',
  }),
  expiresAt: Type.Integer({
    description: 'When the route is removed, in milliseconds since the epoch.',
  }),
});

const Created = Type.Object({
  id: RouteId,
  expiresAt: Type.Integer({
    description:
      'When the route will be removed, in milliseconds since the epoch.',
  }),
  deleteToken: Type.String({
    description:
      'Shown once. Keep it on the device: it is the only way to remove the shared route.',
  }),
});

/** Stable error body: the web app translates `code`, `message` is for developers. */
const ShareError = Type.Object({
  code: Type.Union([
    Type.Literal('invalid_request'),
    Type.Literal('not_found'),
    Type.Literal('already_exists'),
    Type.Literal('forbidden'),
    Type.Literal('payload_too_large'),
  ]),
  message: Type.String(),
});

export interface SharedRoutesOptions {
  store: SharedRouteStore;
  /** PUT is open to anyone: it is throttled much harder than reads. */
  writeRateLimitMax: number;
  writeRateLimitWindowMs: number;
  bodyLimitBytes: number;
}

/** Routes whose time is up are removed this often (and once at startup). */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** `Authorization: Bearer <token>` or nothing. */
function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match ? match[1] : null;
}

export const sharedRoutes: FastifyPluginAsyncTypebox<
  SharedRoutesOptions
> = async (
  fastify,
  { store, writeRateLimitMax, writeRateLimitWindowMs, bodyLimitBytes },
) => {
  // Expired routes are never served (the store hides them); this only frees the space.
  const sweep = () =>
    Promise.resolve()
      .then(() => store.deleteExpired())
      .catch((error: unknown) =>
        fastify.log.error(error, 'could not remove expired shared routes'),
      );
  void sweep();
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  timer.unref();
  fastify.addHook('onClose', async () => clearInterval(timer));

  // Scoped to this plugin: validation and size failures use the same error body.
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .code(413)
        .send({ code: 'payload_too_large', message: error.message });
    }
    if ('validation' in error && error.validation) {
      return reply
        .code(400)
        .send({ code: 'invalid_request', message: error.message });
    }
    throw error;
  });

  fastify.put(
    '/p/:id',
    {
      bodyLimit: bodyLimitBytes,
      config: {
        rateLimit: {
          max: writeRateLimitMax,
          timeWindow: writeRateLimitWindowMs,
        },
      },
      schema: {
        operationId: 'shareRoute',
        tags: ['sharing'],
        summary: 'Share a route by link, without an account',
        description:
          'Creates the shared route under the id drawn on the device, for the lifetime asked ' +
          '(a day, a week or a month). Shared routes are immutable: an id already in use ' +
          'answers 409. The delete token is returned once.',
        params: IdParams,
        body: Type.Composite([
          SharedRouteBody,
          Type.Object({ lifetime: Lifetime }),
        ]),
        response: {
          201: Created,
          400: ShareError,
          409: ShareError,
          413: ShareError,
        },
      },
    },
    async (request, reply) => {
      const deleteToken = randomBytes(32).toString('base64url');
      const { lifetime, ...route } = request.body;
      const expiresAt = Date.now() + LIFETIMES_MS[lifetime];
      const created = await store.create(
        { ...route, id: request.params.id, expiresAt },
        hashToken(deleteToken),
      );
      if (!created) {
        return reply.code(409).send({
          code: 'already_exists',
          message: 'A shared route already uses this id.',
        });
      }
      return reply
        .code(201)
        .send({ id: request.params.id, deleteToken, expiresAt });
    },
  );

  fastify.get(
    '/p/:id',
    {
      schema: {
        operationId: 'getSharedRoute',
        tags: ['sharing'],
        summary: 'Read a shared route',
        params: IdParams,
        response: { 200: SharedRouteResponse, 404: ShareError },
      },
    },
    async (request, reply) => {
      const route = await store.get(request.params.id);
      if (!route) return reply.code(404).send(NOT_FOUND);
      return reply.header('cache-control', 'public, max-age=300').send(route);
    },
  );

  fastify.get(
    '/p/:id.gpx',
    {
      schema: {
        operationId: 'getSharedRouteGpx',
        tags: ['sharing'],
        summary: 'Download a shared route as a GPX file',
        params: IdParams,
        querystring: Type.Object({
          lang: Type.Optional(
            Type.Union(
              GPX_LANGUAGES.map((language) => Type.Literal(language)),
              {
                default: 'en',
                description: 'Language of the waypoint names (start, end).',
              },
            ),
          ),
        }),
        response: {
          200: Type.String({ description: 'A GPX 1.1 document.' }),
          404: ShareError,
        },
      },
    },
    async (request, reply) => {
      const route = await store.get(request.params.id);
      if (!route) return reply.code(404).send(NOT_FOUND);
      const language: GpxLanguage = request.query.lang ?? 'en';
      return reply
        .header('content-type', 'application/gpx+xml; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="${gpxFileName(route.name)}"`,
        )
        .header('cache-control', 'public, max-age=300')
        .send(buildGpx(route, gpxPointNames(language, route.points.length)));
    },
  );

  fastify.delete(
    '/p/:id',
    {
      schema: {
        operationId: 'deleteSharedRoute',
        tags: ['sharing'],
        summary: 'Stop sharing a route',
        description:
          'Needs the delete token returned when the route was shared: ' +
          '`Authorization: Bearer <token>`.',
        params: IdParams,
        response: {
          204: Type.Null(),
          403: ShareError,
          404: ShareError,
        },
      },
    },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      if (!token) return reply.code(403).send(FORBIDDEN);
      const result = await store.remove(request.params.id, hashToken(token));
      if (result === 'not_found') return reply.code(404).send(NOT_FOUND);
      if (result === 'forbidden') return reply.code(403).send(FORBIDDEN);
      return reply.code(204).send(null);
    },
  );
};

const NOT_FOUND = {
  code: 'not_found',
  message: 'No shared route has this id, or it has expired.',
} as const;

const FORBIDDEN = {
  code: 'forbidden',
  message: 'The delete token is missing or does not match.',
} as const;
