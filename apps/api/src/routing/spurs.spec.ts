import { retracedRatio, trimSpurs } from './spurs';
import type { RouteResult } from './routing-provider';

type P = [number, number, number];

/** A square loop of about 4 km, as a list of vertices (the last is the first). */
const square: P[] = [
  [3.0, 45.0, 100],
  [3.03, 45.0, 100],
  [3.03, 45.03, 100],
  [3.0, 45.03, 100],
  [3.0, 45.0, 100],
];

/** A dead end of three vertices that climbs, going out then coming back. */
const spur: P[] = [
  [3.03, 45.01, 100],
  [3.04, 45.01, 150],
  [3.05, 45.01, 200],
];

const routeOf = (geometry: P[]): RouteResult => ({
  geometry,
  distanceMeters: 20_000,
  ascentMeters: 300,
  durationSeconds: 3600,
});

/** The square with the spur taken off its east side. */
const withSpur = (): P[] => [
  square[0],
  square[1],
  // On the east side, leave toward the east and come back the same way.
  [3.03, 45.01, 100],
  ...spur.slice(1),
  ...spur.slice(0, -1).reverse(),
  square[2],
  square[3],
  square[4],
];

describe('retracedRatio', () => {
  it('is 0 for a clean loop', () => {
    expect(retracedRatio(square)).toBe(0);
  });

  it('is 1 for a pure out and back', () => {
    expect(retracedRatio([square[0], square[1], square[0]])).toBe(1);
  });

  it('counts the road driven twice', () => {
    const ratio = retracedRatio(withSpur());
    expect(ratio).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(0.5);
  });
});

describe('trimSpurs', () => {
  it('leaves a clean loop as it is', () => {
    const route = routeOf(square);
    expect(trimSpurs(route)).toBe(route);
  });

  it('cuts a spur and keeps the loop going from where it began', () => {
    const trimmed = trimSpurs(routeOf(withSpur()));
    expect(trimmed.geometry).toEqual([
      square[0],
      square[1],
      [3.03, 45.01, 100],
      square[2],
      square[3],
      square[4],
    ]);
    expect(retracedRatio(trimmed.geometry)).toBe(0);
  });

  it('takes the length, climb and duration of the spur off', () => {
    const route = routeOf(withSpur());
    const trimmed = trimSpurs(route);
    expect(trimmed.distanceMeters).toBeLessThan(route.distanceMeters);
    expect(trimmed.durationSeconds).toBeLessThan(route.durationSeconds);
    expect(trimmed.durationSeconds / route.durationSeconds).toBeCloseTo(
      trimmed.distanceMeters / route.distanceMeters,
      6,
    );
    // The spur climbs 100 m on the way out and the way back goes down.
    expect(trimmed.ascentMeters).toBe(200);
  });

  it('cuts a spur inside a spur', () => {
    const geometry: P[] = [
      square[0],
      square[1],
      [3.03, 45.01, 100],
      [3.035, 45.01, 100],
      [3.04, 45.01, 100],
      [3.04, 45.015, 100],
      [3.04, 45.01, 100],
      [3.035, 45.01, 100],
      [3.03, 45.01, 100],
      square[2],
      square[3],
      square[4],
    ];
    const trimmed = trimSpurs(routeOf(geometry));
    expect(trimmed.geometry).toHaveLength(6);
  });

  it('leaves a route that is mostly out and back', () => {
    const route = routeOf([square[0], square[1], square[0]]);
    expect(trimSpurs(route)).toBe(route);
  });
});
