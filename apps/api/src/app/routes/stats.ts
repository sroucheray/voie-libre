import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyError } from 'fastify';
import type { StatsEntry, StatsStore } from '../../db/stats';

/** Largest number of visitors remembered for the day, so memory stays bounded. */
const MAX_REMEMBERED = 100_000;
/** Days are kept this long (13 months), then removed. */
const RETENTION_DAYS = 395;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const Language = Type.Union([Type.Literal('fr'), Type.Literal('en')]);
const Device = Type.Union([
  Type.Literal('phone'),
  Type.Literal('tablet'),
  Type.Literal('desktop'),
]);
const Profile = Type.Union([
  Type.Literal('road'),
  Type.Literal('gravel'),
  Type.Literal('trail'),
]);

/** The only things a page may report. Anything else is refused. */
const StatsBody = Type.Object(
  {
    event: Type.Union([
      Type.Literal('visit'),
      Type.Literal('route'),
      Type.Literal('loop'),
      Type.Literal('export_gpx'),
      Type.Literal('export_fit'),
      Type.Literal('save'),
    ]),
    language: Type.Optional(Language),
    device: Type.Optional(Device),
    profile: Type.Optional(Profile),
    kilometers: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
    points: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    stops: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  },
  { additionalProperties: false },
);

const StatsError = Type.Object({
  code: Type.Literal('invalid_request'),
  message: Type.String(),
});

export interface StatsRoutesOptions {
  store: StatsStore;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** Distance band of a route, in kilometres. */
export function distanceBand(kilometers: number): string {
  if (kilometers < 20) return 'lt20';
  if (kilometers < 50) return '20-50';
  if (kilometers < 100) return '50-100';
  if (kilometers < 200) return '100-200';
  return 'gt200';
}

const one = (metric: string, dimension: string, total = 0): StatsEntry => ({
  metric,
  dimension,
  count: 1,
  total,
});

export const statsRoutes: FastifyPluginAsyncTypebox<
  StatsRoutesOptions
> = async (fastify, { store, rateLimitMax, rateLimitWindowMs }) => {
  // To know whether a visitor was already counted today. The salt and the hashes live in memory
  // only, are replaced at midnight (UTC) and are never written anywhere.
  let currentDay = dayOf(new Date());
  let salt = randomBytes(16);
  let seen = new Set<string>();

  const isNewToday = (ip: string, userAgent: string, day: string): boolean => {
    if (day !== currentDay) {
      currentDay = day;
      salt = randomBytes(16);
      seen = new Set();
    }
    if (seen.size >= MAX_REMEMBERED) return false;
    const hash = createHash('sha256')
      .update(salt)
      .update(`${ip}\n${userAgent}`)
      .digest('base64');
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  };

  const sweep = () =>
    Promise.resolve()
      .then(() =>
        store.deleteBefore(
          dayOf(new Date(Date.now() - RETENTION_DAYS * 86_400_000)),
        ),
      )
      .catch((error: unknown) =>
        fastify.log.error(error, 'could not remove old statistics'),
      );
  void sweep();
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  timer.unref();
  fastify.addHook('onClose', async () => clearInterval(timer));

  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if ('validation' in error && error.validation) {
      return reply
        .code(400)
        .send({ code: 'invalid_request', message: error.message });
    }
    throw error;
  });

  fastify.post(
    '/stats',
    {
      config: {
        rateLimit: { max: rateLimitMax, timeWindow: rateLimitWindowMs },
      },
      schema: {
        operationId: 'postStats',
        tags: ['stats'],
        summary: 'Count a visit or the use of a feature, in aggregate',
        description:
          'Adds one to a daily counter. Nothing identifies the caller: no address, no user-agent, ' +
          'no route and no place is stored. A request with `DNT: 1` or `Sec-GPC: 1` is ignored.',
        body: StatsBody,
        response: { 204: Type.Null(), 400: StatsError },
      },
    },
    async (request, reply) => {
      if (
        request.headers['dnt'] === '1' ||
        request.headers['sec-gpc'] === '1'
      ) {
        return reply.code(204).send(null);
      }
      const { event, language, device, profile, kilometers, points, stops } =
        request.body;
      const day = dayOf(new Date());
      const entries: StatsEntry[] = [];

      if (event === 'visit') {
        entries.push(one('visit', 'all'));
        if (language) entries.push(one('visit_language', language));
        if (device) entries.push(one('visit_device', device));
        const agent = request.headers['user-agent'] ?? '';
        if (isNewToday(request.ip, agent, day)) {
          entries.push(one('unique', 'all'));
        }
      } else if (event === 'route') {
        entries.push(one('route', profile ?? 'unknown', kilometers ?? 0));
        if (kilometers !== undefined) {
          entries.push(one('route_distance', distanceBand(kilometers)));
        }
        if (points !== undefined)
          entries.push(one('route_points', 'all', points));
        if (stops !== undefined) entries.push(one('route_stops', 'all', stops));
      } else {
        entries.push(one(event, 'all'));
      }

      await store.add(day, entries);
      return reply.code(204).send(null);
    },
  );
};
