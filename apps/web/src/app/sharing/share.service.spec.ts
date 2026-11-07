import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import { API_CLIENT } from '../core/api/api-client';
import type { SavedRoute } from '../storage/saved-route';
import { ShareError, ShareService, shareErrorFrom } from './share.service';

const route: SavedRoute = {
  schemaVersion: 1,
  id: 'abcdefghjk',
  name: 'Col de la Ventouse',
  profile: 'gravel',
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  geometry: [
    [3.087, 45.777, 402],
    [3.249, 45.544, 380],
  ],
  distanceMeters: 41007,
  ascentMeters: 399,
  durationSeconds: 8674,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
};

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('shareErrorFrom', () => {
  it.each([
    [429, { statusCode: 429 }, 'rate_limited'],
    [413, { code: 'payload_too_large' }, 'payload_too_large'],
    [409, { code: 'already_exists' }, 'already_exists'],
    [400, { code: 'invalid_request' }, 'invalid_request'],
    [403, { code: 'forbidden' }, 'forbidden'],
    [404, { code: 'not_found' }, 'not_found'],
    [500, { message: 'boom' }, 'unknown'],
    [409, { code: 'something_new' }, 'unknown'],
    [502, undefined, 'unknown'],
  ] as const)('maps %i %j to %s', (status, body, expected) => {
    expect(shareErrorFrom(status, body)).toBe(expected);
  });
});

describe('ShareService', () => {
  let requests: {
    method: string;
    url: string;
    headers: Headers;
    body: unknown;
  }[];
  let respond: (request: Request) => Promise<Response> | Response;
  let service: ShareService;

  beforeEach(() => {
    requests = [];
    respond = () => json({});
    TestBed.configureTestingModule({
      providers: [
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              const text = await request.clone().text();
              requests.push({
                method: request.method,
                url: request.url,
                headers: request.headers,
                body: text ? JSON.parse(text) : undefined,
              });
              return respond(request);
            },
          }),
        },
      ],
    });
    service = TestBed.inject(ShareService);
  });

  async function failure(promise: Promise<unknown>): Promise<ShareError> {
    try {
      await promise;
    } catch (error) {
      return error as ShareError;
    }
    throw new Error('expected a rejection');
  }

  it('builds the link on this web app', () => {
    expect(service.linkFor('abcdefghjk')).toMatch(/\/p\/abcdefghjk$/);
  });

  describe('share', () => {
    it('puts the route under its own id, without the local-only fields', async () => {
      respond = () => json({ id: route.id, deleteToken: 'secret' }, 201);
      const info = await service.share(route);
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('PUT');
      expect(requests[0].url).toBe('http://api.test/p/abcdefghjk');
      expect(requests[0].body).toEqual({
        name: route.name,
        profile: 'gravel',
        points: route.points,
        geometry: route.geometry,
        distanceMeters: 41007,
        ascentMeters: 399,
        durationSeconds: 8674,
        createdAt: 1_700_000_000_000,
      });
      expect(info.deleteToken).toBe('secret');
      expect(info.sharedAt).toBeGreaterThan(0);
    });

    it.each([
      [409, { code: 'already_exists', message: 'x' }, 'already_exists'],
      [
        429,
        { statusCode: 429, message: 'Rate limit exceeded' },
        'rate_limited',
      ],
      [413, { code: 'payload_too_large', message: 'x' }, 'payload_too_large'],
      [400, { code: 'invalid_request', message: 'x' }, 'invalid_request'],
    ] as const)('reports a %i as %s', async (status, body, code) => {
      respond = () => json(body, status);
      expect((await failure(service.share(route))).code).toBe(code);
    });

    it('reports an unreachable server as a network failure', async () => {
      respond = () => {
        throw new TypeError('Failed to fetch');
      };
      expect((await failure(service.share(route))).code).toBe('network');
    });
  });

  describe('unshare', () => {
    const shared = { ...route, share: { deleteToken: 'secret', sharedAt: 1 } };

    it('sends the token as a bearer token, never in the URL', async () => {
      respond = () => json(null, 204);
      await service.unshare(shared);
      expect(requests[0].method).toBe('DELETE');
      expect(requests[0].url).toBe('http://api.test/p/abcdefghjk');
      expect(requests[0].headers.get('authorization')).toBe('Bearer secret');
    });

    it('counts a route that is already gone as removed', async () => {
      respond = () => json({ code: 'not_found', message: 'x' }, 404);
      await expect(service.unshare(shared)).resolves.toBeUndefined();
    });

    it('reports a refused token', async () => {
      respond = () => json({ code: 'forbidden', message: 'x' }, 403);
      expect((await failure(service.unshare(shared))).code).toBe('forbidden');
    });

    it('does nothing for a route that is not shared', async () => {
      await service.unshare(route);
      expect(requests).toEqual([]);
    });

    it('reports an unreachable server', async () => {
      respond = () => {
        throw new TypeError('Failed to fetch');
      };
      expect((await failure(service.unshare(shared))).code).toBe('network');
    });
  });

  describe('fetch', () => {
    it('reads a shared route', async () => {
      const body = {
        ...route,
        sharedAt: 1_700_000_200_000,
      };
      respond = () => json(body);
      const shared = await service.fetch('abcdefghjk');
      expect(requests[0].method).toBe('GET');
      expect(requests[0].url).toBe('http://api.test/p/abcdefghjk');
      expect(shared.name).toBe('Col de la Ventouse');
      expect(shared.geometry).toEqual(route.geometry);
    });

    it('reports an unknown id', async () => {
      respond = () => json({ code: 'not_found', message: 'x' }, 404);
      expect((await failure(service.fetch('zzzzzzzz'))).code).toBe('not_found');
    });
  });
});
