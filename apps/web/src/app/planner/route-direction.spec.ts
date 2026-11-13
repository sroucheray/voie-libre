import { directionRuns } from './route-direction';
import type { LngLat3 } from './planner-map-driver';

// About 111 m per 0.001 degree of latitude.
const line = (n: number, lonOffset = 0): LngLat3[] =>
  Array.from({ length: n }, (_, i) => [3 + lonOffset, 45 + i * 0.001, 300]);

describe('directionRuns', () => {
  it('has nothing for fewer than two points', () => {
    expect(directionRuns([])).toEqual([]);
    expect(directionRuns(line(1))).toEqual([]);
  });

  it('calls a route ridden once single, all the way', () => {
    expect(directionRuns(line(20))).toEqual([
      { kind: 'single', from: 0, to: 19 },
    ]);
  });

  it('calls an out-and-back double, all the way', () => {
    const out = line(10);
    const back = [...out].reverse();
    const runs = directionRuns([...out, ...back.slice(1)]);
    expect(runs.every((run) => run.kind === 'double')).toBe(true);
    expect(runs).toEqual([{ kind: 'double', from: 0, to: 18 }]);
  });

  it('still finds the way back when it lies a few meters off the way out', () => {
    const out = line(10);
    // 0.00005 degrees of longitude is about 4 m.
    const back = line(10, 0.00005).reverse();
    const runs = directionRuns([...out, ...back]);
    expect(runs.every((run) => run.kind === 'double')).toBe(true);
  });

  it('keeps a way back that is another road single', () => {
    const out = line(10);
    // 0.002 degrees of longitude is about 150 m away.
    const back = line(10, 0.002).reverse();
    const runs = directionRuns([...out, ...back]);
    expect(runs.every((run) => run.kind === 'single')).toBe(true);
  });

  it('splits a route that has a stem ridden both ways and a loop ridden once', () => {
    const stem = line(6);
    // A loop to the east, ridden once, from the end of the stem.
    const loop: LngLat3[] = [
      [3.002, 45.005, 300],
      [3.004, 45.003, 300],
      [3.003, 45.001, 300],
      [3.001, 45.0, 300],
    ];
    const runs = directionRuns([
      ...stem,
      ...loop,
      // Back along the stem.
      ...[...stem].reverse(),
    ]);
    const kinds = runs.map((run) => run.kind);
    expect(kinds[0]).toBe('double');
    expect(kinds).toContain('single');
    expect(kinds.at(-1)).toBe('double');
  });
});
