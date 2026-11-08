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
    [504, undefined, 'unavailable'], // answered by the service worker when offline
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

  describe('editing a route on screen', () => {
    /** A straight route along the equator, one vertex per 0.001° (about 111 m). */
    const line = Array.from({ length: 201 }, (_, i) => [i / 1000, 0, 100]);
    const longRoute = {
      routes: [
        {
          geometry: line,
          distanceMeters: 22_239,
          ascentMeters: 10,
          durationSeconds: 3600,
        },
      ],
    };
    const detour = {
      routes: [
        {
          geometry: [
            [0.09, 0, 100],
            [0.1, 0.002, 100],
            [0.11, 0, 100],
          ],
          distanceMeters: 2_600,
          ascentMeters: 0,
          durationSeconds: 400,
        },
      ],
    };

    beforeEach(async () => {
      respond = async () => json(longRoute);
      store.addPoint([0, 0]);
      store.addPoint([0.2, 0]);
      await settle();
      expect(requests).toHaveLength(1);
      respond = async () => json(detour);
    });

    it('recomputes only the stretch around a point added beside the route', async () => {
      store.addPoint([0.1, 0.002]);
      await settle();
      expect(requests).toHaveLength(2);
      const body = requests[1].body as {
        points: { lon: number; lat: number }[];
        alternatives: number;
      };
      expect(body.alternatives).toBe(1);
      expect(body.points).toHaveLength(3);
      expect(body.points[1]).toEqual({ lon: 0.1, lat: 0.002 });
      // The other two points are vertices of the route, on both sides of the new one.
      expect(body.points[0].lon).toBeLessThan(0.1);
      expect(body.points[2].lon).toBeGreaterThan(0.1);
      expect(body.points[0].lat).toBe(0);
      expect(body.points[2].lat).toBe(0);

      const [route] = store.routes();
      expect(store.routes()).toHaveLength(1);
      expect(route.geometry[0]).toEqual(line[0]);
      expect(route.geometry.at(-1)).toEqual(line[200]);
      expect(route.geometry).toContainEqual([0.1, 0.002, 100]);
      // Far from the edit, the route is exactly what it was.
      expect(route.geometry.slice(0, 50)).toEqual(line.slice(0, 50));
      expect(route.geometry.slice(-50)).toEqual(line.slice(-50));
      expect(store.status()).toBe('ready');
    });

    it('does not compute again once the stretch is in place', async () => {
      store.addPoint([0.1, 0.002]);
      await settle();
      await vi.advanceTimersByTimeAsync(5 * ROUTE_DEBOUNCE_MS);
      expect(requests).toHaveLength(2);
      expect(store.alternatives()).toBe(1);
    });

    it('recomputes a moved waypoint locally and a removed one between its neighbours', async () => {
      store.addPoint([0.1, 0.002]);
      await settle();
      store.movePoint(1, [0.1, 0.003]);
      await settle();
      expect(requests).toHaveLength(3);
      expect((requests[2].body as { points: unknown[] }).points).toHaveLength(
        3,
      );
      store.removePoint(1);
      await settle();
      expect(requests).toHaveLength(4);
      expect((requests[3].body as { points: unknown[] }).points).toHaveLength(
        2,
      );
    });

    it('routes between both sides of a spur when the waypoint at its tip is removed', async () => {
      // The answer goes from a vertex of the route to the point and back, then on to the other
      // vertex, like BRouter does for a point beside the road.
      respond = async () =>
        json({
          routes: [
            {
              geometry: [
                [0.095, 0, 100],
                [0.1, 0.002, 100],
                [0.095, 0, 100],
                [0.105, 0, 100],
              ],
              distanceMeters: 2_300,
              ascentMeters: 0,
              durationSeconds: 300,
            },
          ],
        });
      store.addPoint([0.1, 0.002]);
      await settle();
      expect(requests).toHaveLength(2);
      respond = async () =>
        json({
          routes: [
            {
              geometry: line.slice(90, 111),
              distanceMeters: 2_200,
              ascentMeters: 0,
              durationSeconds: 300,
            },
          ],
        });
      store.removePoint(1);
      await settle();
      expect(requests).toHaveLength(3);
      const points = (requests[2].body as { points: { lon: number }[] }).points;
      // Never from a place to itself: that is not a route.
      expect(points).toHaveLength(2);
      expect(points[0]).not.toEqual(points[1]);
      expect(store.status()).toBe('ready');
      const [route] = store.routes();
      expect(route.geometry).not.toContainEqual([0.1, 0.002, 100]);
    });

    it('computes everything when the profile changes after an edit', async () => {
      store.addPoint([0.1, 0.002]);
      await settle();
      respond = async () => json(longRoute);
      store.setProfile('gravel');
      await settle();
      expect(requests).toHaveLength(3);
      expect((requests[2].body as { points: unknown[] }).points).toHaveLength(
        3,
      );
      expect(requests[2].body).toMatchObject({ profile: 'gravel' });
      expect(store.routes()[0].geometry).toHaveLength(201);
    });

    it('computes everything when the route is not up to date with the points', async () => {
      store.addPoint([0.1, 0.002]);
      TestBed.tick();
      expect(store.status()).toBe('loading');
      store.addPoint([0.15, 0.002]);
      await settle();
      expect(requests).toHaveLength(2);
      expect((requests[1].body as { points: unknown[] }).points).toHaveLength(
        4,
      );
    });

    it('computes everything when the end is removed', async () => {
      store.addPoint([0.1, 0.002]);
      await settle();
      store.removePoint(2);
      await settle();
      expect(requests).toHaveLength(3);
      expect((requests[2].body as { points: unknown[] }).points).toEqual([
        { lon: 0, lat: 0 },
        { lon: 0.1, lat: 0.002 },
      ]);
    });

    it('keeps the route on screen when the stretch cannot be computed', async () => {
      respond = async () => json({ code: 'no_route', message: 'x' }, 422);
      store.addPoint([0.1, 0.002]);
      await settle();
      expect(store.status()).toBe('error');
      expect(store.errorCode()).toBe('no_route');
      expect(store.routes()).toHaveLength(1);
      expect(store.routes()[0].geometry).toHaveLength(201);
    });

    it('computes everything on the next change after a failed stretch', async () => {
      respond = async () => json({ code: 'no_route', message: 'x' }, 422);
      store.addPoint([0.1, 0.002]);
      await settle();
      respond = async () => json(longRoute);
      store.addPoint([0.15, 0.002]);
      await settle();
      expect(requests).toHaveLength(3);
      expect((requests[2].body as { points: unknown[] }).points).toHaveLength(
        4,
      );
      expect(store.status()).toBe('ready');
    });
  });

  describe('every kind of route', () => {
    /** A square loop of 0.1° (about 11 km a side) from [0, 0], one vertex per 0.001°. */
    const side = Array.from({ length: 100 }, (_, i) => i / 1000);
    const loopGeometry = [
      ...side.map((x) => [x, 0, 100]),
      ...side.map((y) => [0.1, y, 100]),
      ...side.map((x) => [0.1 - x, 0.1, 100]),
      ...side.map((y) => [0, 0.1 - y, 100]),
      [0, 0, 100],
    ];
    const loopBody = {
      routes: [
        {
          geometry: loopGeometry,
          distanceMeters: 44_000,
          ascentMeters: 100,
          durationSeconds: 8000,
        },
      ],
    };
    const stretchBody = {
      routes: [
        {
          geometry: [
            [0.04, 0, 100],
            [0.05, 0.004, 100],
            [0.06, 0, 100],
          ],
          distanceMeters: 2_000,
          ascentMeters: 0,
          durationSeconds: 300,
        },
      ],
    };
    const S: [number, number] = [0, 0];

    type Body = {
      points: { lon: number; lat: number }[];
      alternatives: number;
      loop?: unknown;
    };

    it('keeps a loop by distance when a point is added on or beside it', async () => {
      respond = async () => json(loopBody);
      store.addPoint(S);
      store.closeLoop({ mode: 'distance', distanceMeters: 30_000 });
      await settle();
      expect((requests[0].body as Body).loop).toEqual({
        mode: 'distance',
        distanceMeters: 30_000,
      });

      respond = async () => json(stretchBody);
      store.addPoint([0.05, 0.004]);
      await settle();
      expect(requests).toHaveLength(2);
      const body = requests[1].body as Body;
      expect(body.loop).toBeUndefined();
      expect(body.points).toHaveLength(3);
      expect(body.points[1]).toEqual({ lon: 0.05, lat: 0.004 });

      const [route] = store.routes();
      // About 900 m of the loop on each side of the point were replaced by 3 vertices.
      expect(route.geometry.length).toBeGreaterThan(loopGeometry.length - 30);
      expect(route.geometry.length).toBeLessThan(loopGeometry.length - 5);
      expect(route.geometry.slice(0, 40)).toEqual(loopGeometry.slice(0, 40));
      expect(route.geometry.slice(-300)).toEqual(loopGeometry.slice(-300));
      expect(store.loop()).toBeNull();
      expect(store.isLoop()).toBe(true);
    });

    it('moves the start of a loop by distance by computing the loop again', async () => {
      respond = async () => json(loopBody);
      store.addPoint(S);
      store.closeLoop({ mode: 'distance', distanceMeters: 30_000 });
      await settle();
      store.movePoint(0, [0.2, 0.2]);
      await settle();
      expect(requests).toHaveLength(2);
      const body = requests[1].body as Body;
      expect(body.points).toHaveLength(2);
      expect(body.loop).toEqual({ mode: 'distance', distanceMeters: 30_000 });
    });

    it('moves the turnaround of a loop avoiding the way out without computing the loop again', async () => {
      respond = async () => json(loopBody);
      store.addPoint(S);
      store.addPoint([0.1, 0.1]);
      store.closeLoop({ mode: 'avoid_outbound' });
      await settle();
      expect((requests[0].body as Body).loop).toEqual({
        mode: 'avoid_outbound',
      });

      respond = async () => json(stretchBody);
      store.movePoint(1, [0.1, 0.103]);
      await settle();
      await vi.advanceTimersByTimeAsync(5 * ROUTE_DEBOUNCE_MS);
      expect(requests).toHaveLength(2);
      const body = requests[1].body as Body;
      expect(body.loop).toBeUndefined();
      expect(body.points).toHaveLength(3);
      expect(body.points[1]).toEqual({ lon: 0.1, lat: 0.103 });
      expect(store.routes()[0].geometry[0]).toEqual([0, 0, 100]);
      expect(store.status()).toBe('ready');
    });

    it('keeps an imported route without elevation as it is outside the stretch', async () => {
      const line = Array.from({ length: 201 }, (_, i) => [i / 1000, 0, 0]);
      store.loadSaved({
        points: [
          [0, 0],
          [0.2, 0],
        ],
        profile: 'gravel',
        geometry: line as [number, number, number][],
        distanceMeters: 22_239,
        ascentMeters: null,
        durationSeconds: 3600,
        elevationSource: undefined,
      });
      await settle();
      expect(requests).toHaveLength(0);

      respond = async () => json(stretchBody);
      store.addPoint([0.05, 0.004]);
      await settle();
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toMatchObject({
        profile: 'gravel',
        alternatives: 1,
      });
      const [route] = store.routes();
      expect(route.ascentMeters).toBeNull();
      expect(store.elevationKnown()).toBe(false);
      expect(route.geometry.slice(0, 30)).toEqual(line.slice(0, 30));
      expect(route.geometry.slice(-30)).toEqual(line.slice(-30));
    });
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

    it('computes only a stretch on the first change made after opening', async () => {
      store.loadSaved(saved);
      await settle();
      store.movePoint(1, [3.3, 45.5]);
      await settle();
      expect(requests).toHaveLength(1);
      // The moved end is routed from the saved route's vertex just before it, not from the start.
      expect(requests[0].body).toEqual({
        points: [
          { lon: 3.15, lat: 45.65 },
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
