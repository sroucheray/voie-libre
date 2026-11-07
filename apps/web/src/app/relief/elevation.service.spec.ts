import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import { API_CLIENT } from '../core/api/api-client';
import {
  ElevationError,
  ElevationService,
  fillGaps,
} from './elevation.service';

const geometry: [number, number, number][] = [
  [3, 45, 0],
  [3, 45.001, 0],
  [3, 45.002, 0],
  [3, 45.003, 0],
];

function service(respond: (body: unknown) => Response | Promise<Response>) {
  TestBed.resetTestingModule();
  const calls: unknown[] = [];
  TestBed.configureTestingModule({
    providers: [
      {
        provide: API_CLIENT,
        useValue: createApiClient({
          baseUrl: 'http://api.test',
          fetch: async (request) => {
            const body = await request.clone().json();
            calls.push(body);
            return respond(body);
          },
        }),
      },
    ],
  });
  return { service: TestBed.inject(ElevationService), calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as ElevationError).code;
  }
  return null;
};

describe('fillGaps', () => {
  it('interpolates inside, copies at the ends, leaves values alone', () => {
    expect(fillGaps([null, 10, null, null, 40, null])).toEqual([
      10, 10, 20, 30, 40, 40,
    ]);
    expect(fillGaps([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('ElevationService', () => {
  it('sends the positions and returns the geometry with elevations and the climb', async () => {
    const { service: s, calls } = service(() =>
      json({ elevations: [100, 110, 125, 120] }),
    );
    const result = await s.forGeometry(geometry);
    expect(calls).toEqual([
      {
        points: [
          { lon: 3, lat: 45 },
          { lon: 3, lat: 45.001 },
          { lon: 3, lat: 45.002 },
          { lon: 3, lat: 45.003 },
        ],
      },
    ]);
    expect(result.geometry.map((p) => p[2])).toEqual([100, 110, 125, 120]);
    expect(result.ascentMeters).toBe(25);
  });

  it('fills a few missing points but refuses a route the data does not cover', async () => {
    const some = service(() =>
      json({ elevations: [100, null, 120, 130, 140] }),
    );
    const ok = await some.service.forGeometry([...geometry, [3, 45.004, 0]]);
    expect(ok.geometry[1][2]).toBe(110);

    const none = service(() => json({ elevations: [null, null, null, null] }));
    expect(await code(none.service.forGeometry(geometry))).toBe(
      'elevation_no_data',
    );
  });

  it('turns failures into codes', async () => {
    expect(
      await code(
        service(() => json({ code: 'x' }, 429)).service.forGeometry(geometry),
      ),
    ).toBe('elevation_rate_limited');
    expect(
      await code(
        service(() => json({ code: 'x' }, 503)).service.forGeometry(geometry),
      ),
    ).toBe('elevation_unavailable');
    expect(
      await code(
        service(() => json({ code: 'x' }, 500)).service.forGeometry(geometry),
      ),
    ).toBe('elevation_unknown');
    expect(
      await code(
        service(() => {
          throw new TypeError('offline');
        }).service.forGeometry(geometry),
      ),
    ).toBe('elevation_network');
  });
});
