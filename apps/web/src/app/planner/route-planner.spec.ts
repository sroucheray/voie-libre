import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import { API_CLIENT } from '../core/api/api-client';
import {
  ROUTE_DEBOUNCE_MS,
  RoutePlanner,
  errorCodeFrom,
} from './route-planner';
import { PlannerStore } from './planner-store';
import {
  SAVED_ROUTE_SCHEMA_VERSION,
  type SavedRoute,
} from '../storage/saved-route';

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

  describe('opening a saved route', () => {
    const saved: SavedRoute = {
      schemaVersion: SAVED_ROUTE_SCHEMA_VERSION,
      id: 'abcdefghjk',
      name: 'Saved',
      profile: 'trail',
      points: [
        [3.087, 45.777],
        [3.249, 45.544],
      ],
      geometry: [
        [3.087, 45.777, 402],
        [3.15, 45.65, 390],
        [3.249, 45.544, 380],
      ],
      distanceMeters: 41007,
      ascentMeters: 399,
      durationSeconds: 8674,
      createdAt: 1,
      updatedAt: 1,
    };

    it('restores points, profile and itinerary without calling the API', async () => {
      store.loadSaved(saved);
      await settle();
      await vi.advanceTimersByTimeAsync(5 * ROUTE_DEBOUNCE_MS);
      expect(requests).toHaveLength(0);
      expect(store.status()).toBe('ready');
      expect(store.points()).toEqual(saved.points);
      expect(store.profile()).toBe('trail');
      expect(store.alternatives()).toBe(1);
      expect(store.routes()).toEqual([
        {
          geometry: saved.geometry,
          distanceMeters: 41007,
          ascentMeters: 399,
          durationSeconds: 8674,
        },
      ]);
      expect(store.viewRequest()?.geometry).toEqual(saved.geometry);
    });

    it('cancels a computation still in flight when a route is opened', async () => {
      store.addPoint([3, 45]);
      store.addPoint([3.2, 45.2]);
      await settle();
      store.addPoint([3.1, 45.1]);
      TestBed.tick();
      store.loadSaved(saved);
      await settle();
      expect(store.routes()[0].distanceMeters).toBe(41007);
      expect(requests.at(-1)?.signal.aborted ?? true).toBe(true);
    });

    it('computes normally on the first change made after opening', async () => {
      store.loadSaved(saved);
      await settle();
      store.movePoint(1, [3.3, 45.5]);
      await settle();
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        points: [
          { lon: 3.087, lat: 45.777 },
          { lon: 3.3, lat: 45.5 },
        ],
        profile: 'trail',
        alternatives: 1,
      });
    });

    it('computes when the profile changes after opening', async () => {
      store.loadSaved(saved);
      await settle();
      store.setProfile('road');
      await settle();
      expect(requests).toHaveLength(1);
    });

    it('computes again when the user comes back to the opened points', async () => {
      store.loadSaved(saved);
      await settle();
      store.movePoint(1, [3.3, 45.5]);
      await settle();
      store.movePoint(1, [3.249, 45.544]);
      await settle();
      expect(requests).toHaveLength(2);
    });

    it('opens the same route twice without computing', async () => {
      store.loadSaved(saved);
      await settle();
      store.loadSaved(saved);
      await settle();
      expect(requests).toHaveLength(0);
      expect(store.status()).toBe('ready');
    });

    it('can be saved again as it was opened', async () => {
      store.loadSaved(saved);
      await settle();
      expect(store.savable()).toEqual({
        points: saved.points,
        profile: 'trail',
        geometry: saved.geometry,
        distanceMeters: 41007,
        ascentMeters: 399,
        durationSeconds: 8674,
      });
    });
  });
});
