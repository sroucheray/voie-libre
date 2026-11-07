import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import { API_CLIENT } from '../core/api/api-client';
import {
  ROUTE_DEBOUNCE_MS,
  RoutePlanner,
  errorCodeFrom,
} from './route-planner';
import { PlannerStore } from './planner-store';

const routeBody = {
  routes: [
    {
      geometry: [
        [3.087, 45.777, 402],
        [3.249, 45.544, 380],
      ],
      distanceMeters: 41007,
      ascentMeters: 399,
      durationSeconds: 8674,
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('errorCodeFrom', () => {
  it.each([
    [400, { code: 'invalid_request' }, 'invalid_request'],
    [422, { code: 'no_route' }, 'no_route'],
    [503, { code: 'unavailable' }, 'unavailable'],
    [502, { code: 'provider_error' }, 'provider_error'],
    [429, { statusCode: 429, message: 'Rate limit exceeded' }, 'rate_limited'],
    [500, { message: 'boom' }, 'unknown'],
    [418, undefined, 'unknown'],
    [400, { code: 'something_new' }, 'unknown'],
  ] as const)('maps %i %j to %s', (status, body, expected) => {
    expect(errorCodeFrom(status, body)).toBe(expected);
  });
});

describe('RoutePlanner', () => {
  let store: PlannerStore;
  let requests: { body: unknown; signal: AbortSignal }[];
  let respond: (request: Request) => Promise<Response>;

  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    respond = async () => json(routeBody);
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: async (request) => {
        requests.push({
          body: await request.clone().json(),
          signal: request.signal,
        });
        return respond(request);
      },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: API_CLIENT, useValue: client }],
    });
    store = TestBed.inject(PlannerStore);
    TestBed.inject(RoutePlanner);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs the effect, then lets the debounce and the request settle. */
  async function settle() {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(ROUTE_DEBOUNCE_MS + 10);
  }

  it('does not call the API with fewer than two points', async () => {
    store.addPoint([3, 45]);
    await settle();
    expect(requests).toHaveLength(0);
    expect(store.status()).toBe('idle');
  });

  it('requests the route once the user stops editing, and stores the result', async () => {
    store.addPoint([3.087, 45.777]);
    store.addPoint([3.249, 45.544]);
    TestBed.tick();
    expect(store.status()).toBe('loading');
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(ROUTE_DEBOUNCE_MS + 10);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      points: [
        { lon: 3.087, lat: 45.777 },
        { lon: 3.249, lat: 45.544 },
      ],
      profile: 'road',
      alternatives: 1,
    });
    expect(store.status()).toBe('ready');
    expect(store.routes()).toHaveLength(1);
  });

  it('groups quick edits into one request', async () => {
    store.addPoint([3, 45]);
    store.addPoint([3.2, 45.2]);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(100);
    store.setProfile('trail');
    store.setAlternatives(2);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(ROUTE_DEBOUNCE_MS + 10);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      profile: 'trail',
      alternatives: 2,
    });
  });

  it('aborts the request in flight when something changes, and ignores its answer', async () => {
    let release!: () => void;
    respond = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json(routeBody));
      });
    store.addPoint([3, 45]);
    store.addPoint([3.2, 45.2]);
    await settle();
    expect(requests).toHaveLength(1);
    store.setProfile('gravel');
    TestBed.tick();
    expect(requests[0].signal.aborted).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.routes()).toEqual([]);
    expect(store.status()).toBe('loading');
  });

  it('clears the routes when a point is removed below two', async () => {
    store.addPoint([3, 45]);
    store.addPoint([3.2, 45.2]);
    await settle();
    expect(store.status()).toBe('ready');
    store.removePoint(1);
    await settle();
    expect(store.status()).toBe('idle');
    expect(store.routes()).toEqual([]);
  });

  it.each([
    [422, { code: 'no_route', message: 'x' }, 'no_route'],
    [503, { code: 'unavailable', message: 'x' }, 'unavailable'],
    [400, { code: 'invalid_request', message: 'x' }, 'invalid_request'],
    [429, { statusCode: 429 }, 'rate_limited'],
  ] as const)('reports an API %i as %s', async (status, body, code) => {
    respond = async () => json(body, status);
    store.addPoint([3, 45]);
    store.addPoint([3.2, 45.2]);
    await settle();
    expect(store.status()).toBe('error');
    expect(store.errorCode()).toBe(code);
  });

  it('reports a network failure as unavailable', async () => {
    respond = async () => {
      throw new TypeError('Failed to fetch');
    };
    store.addPoint([3, 45]);
    store.addPoint([3.2, 45.2]);
    await settle();
    expect(store.errorCode()).toBe('unavailable');
  });
});
