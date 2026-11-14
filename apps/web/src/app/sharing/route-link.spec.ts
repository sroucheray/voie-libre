import type { LngLat } from '../core/map/map-factory';
import { MAX_POINTS } from '../planner/planner-store';
import {
  ROUTE_LINK_NAME_MAX,
  decodeRouteLink,
  encodeRouteLink,
  routeLinkUrl,
  type RouteLink,
} from './route-link';

const A: LngLat = [3.087, 45.777];
const B: LngLat = [3.249, 45.544];
const S: LngLat = [-1.5532, -22.2711];

const ok = (fragment: string): RouteLink => {
  const result = decodeRouteLink(fragment);
  if (!result.ok) throw new Error(`unreadable: ${result.code}`);
  return result.link;
};

describe('route link', () => {
  it('round-trips which alternative of a loop by distance was chosen', () => {
    const link: RouteLink = {
      points: [A, A],
      profile: 'road',
      loop: { mode: 'distance', distanceMeters: 30000 },
      alternative: { rank: 2, count: 3 },
    };
    expect(ok(encodeRouteLink(link))).toEqual(link);
  });

  it('leaves the alternative out when only one was asked, or for another route', () => {
    const loop = { mode: 'distance', distanceMeters: 30000 } as const;
    expect(
      encodeRouteLink({
        points: [A, A],
        profile: 'road',
        loop,
        alternative: { rank: 1, count: 1 },
      }),
    ).not.toContain('a=');
    expect(
      encodeRouteLink({
        points: [A, B],
        profile: 'road',
        loop: null,
        alternative: { rank: 2, count: 3 },
      }),
    ).not.toContain('a=');
  });

  it.each(['a=4.4', 'a=3.2', 'a=0.2', 'a=x', 'a=2'])(
    'rejects the alternative %s',
    (alt) => {
      const base = encodeRouteLink({
        points: [A, A],
        profile: 'road',
        loop: { mode: 'distance', distanceMeters: 30000 },
      });
      expect(decodeRouteLink(`${base}&${alt}`)).toEqual({
        ok: false,
        code: 'invalid',
      });
    },
  );

  it('rejects an alternative on a route that is no loop by distance', () => {
    const base = encodeRouteLink({
      points: [A, B],
      profile: 'road',
      loop: null,
    });
    expect(decodeRouteLink(`${base}&a=2.3`)).toEqual({
      ok: false,
      code: 'invalid',
    });
  });

  it('round-trips an itinerary, with a name', () => {
    const link: RouteLink = {
      points: [A, S, B],
      profile: 'gravel',
      loop: null,
      name: 'Clermont → Issoire, été',
    };
    expect(ok(encodeRouteLink(link))).toEqual(link);
  });

  it('rounds coordinates to 5 decimals', () => {
    const link = ok(
      encodeRouteLink({
        points: [[3.0870049, 45.7770049], B],
        profile: 'road',
        loop: null,
      }),
    );
    expect(link.points[0]).toEqual([3.087, 45.777]);
  });

  it('keeps a loop closed', () => {
    const link = ok(
      encodeRouteLink({
        points: [A, B, A],
        profile: 'trail',
        loop: { mode: 'avoid_outbound' },
      }),
    );
    expect(link.points[2]).toEqual(link.points[0]);
    expect(link.loop).toEqual({ mode: 'avoid_outbound' });
  });

  it.each([
    [{ mode: 'distance', distanceMeters: 30000 }],
    [{ mode: 'distance', distanceMeters: 30000, ascentMeters: 500 }],
    [{ mode: 'distance', distanceMeters: 30000, direction: 'ne' }],
    [
      {
        mode: 'distance',
        distanceMeters: 12500,
        ascentMeters: 800,
        direction: 'sw',
      },
    ],
  ] as const)('round-trips the loop by distance %j', (loop) => {
    const link: RouteLink = { points: [A, A], profile: 'road', loop };
    expect(ok(encodeRouteLink(link)).loop).toEqual(loop);
  });

  it('stays under 2,000 characters for 20 points spread over France', () => {
    const points: LngLat[] = Array.from({ length: MAX_POINTS }, (_, i) => [
      -4.5 + (i % 2 ? 9 : 0) + i * 0.001,
      42.5 + (i % 2 ? 5 : 0) + i * 0.001,
    ]);
    const fragment = encodeRouteLink({
      points,
      profile: 'road',
      loop: null,
      name: 'x'.repeat(200),
    });
    expect(fragment.length).toBeLessThan(500);
    expect(ok(fragment).name).toHaveLength(ROUTE_LINK_NAME_MAX);
    expect(ok(fragment).points).toHaveLength(MAX_POINTS);
  });

  it('builds the full address and reads a leading #', () => {
    const link: RouteLink = { points: [A, B], profile: 'road', loop: null };
    const url = routeLinkUrl('https://voielibre.app', link);
    expect(url.startsWith('https://voielibre.app/r#v=1&')).toBe(true);
    expect(ok(url.slice(url.indexOf('#')))).toEqual(link);
  });

  describe('rejects', () => {
    const good = encodeRouteLink({
      points: [A, B],
      profile: 'road',
      loop: null,
    });

    it.each([
      ['an empty fragment', '', 'unreadable'],
      ['no version', 'p=road&c=abc', 'unreadable'],
      ['an unknown version', good.replace('v=1', 'v=2'), 'unsupported_version'],
      ['an unknown profile', good.replace('p=road', 'p=boat'), 'invalid'],
      ['no points', 'v=1&p=road', 'invalid'],
      ['a character outside the alphabet', 'v=1&p=road&c=ab!d', 'invalid'],
      ['a cut link (a number left open)', `${good}`.slice(0, -1), 'invalid'],
      [
        'a single point',
        encodeRouteLink({ points: [A], profile: 'road', loop: null }),
        'invalid',
      ],
    ])('%s', (_label, fragment, code) => {
      expect(decodeRouteLink(fragment)).toEqual({ ok: false, code });
    });

    it('more than 20 points', () => {
      const points = Array.from({ length: MAX_POINTS + 1 }, () => A);
      expect(
        decodeRouteLink(
          encodeRouteLink({ points, profile: 'road', loop: null }),
        ),
      ).toEqual({
        ok: false,
        code: 'invalid',
      });
    });

    it('coordinates out of range', () => {
      const fragment = encodeRouteLink({
        points: [
          [200, 10],
          [201, 11],
        ],
        profile: 'road',
        loop: null,
      });
      expect(decodeRouteLink(fragment)).toEqual({ ok: false, code: 'invalid' });
    });

    it.each(['x', 'd1000', 'd999999999', 'd30000,99999', 'd30000,,up'])(
      'the loop mode %s',
      (loop) => {
        expect(decodeRouteLink(`${good}&l=${loop}`)).toEqual({
          ok: false,
          code: 'invalid',
        });
      },
    );
  });
});
