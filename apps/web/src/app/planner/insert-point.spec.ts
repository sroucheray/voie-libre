import { insertionIndex } from './insert-point';
import type { LngLat3 } from './planner-map-driver';

/** A straight route along the equator, one vertex per 0.1°: easy to reason about. */
const line: LngLat3[] = Array.from({ length: 11 }, (_, i) => [i / 10, 0, 0]);

describe('insertionIndex', () => {
  it('puts a point dragged from the only segment right before the end', () => {
    expect(
      insertionIndex(
        line,
        [
          [0, 0],
          [1, 0],
        ],
        [0.5, 0],
      ),
    ).toBe(1);
  });

  it('finds the segment between two waypoints', () => {
    const points: [number, number][] = [
      [0, 0],
      [0.3, 0],
      [0.7, 0],
      [1, 0],
    ];
    expect(insertionIndex(line, points, [0.1, 0])).toBe(1);
    expect(insertionIndex(line, points, [0.5, 0])).toBe(2);
    expect(insertionIndex(line, points, [0.9, 0])).toBe(3);
  });

  it('matches points forward, so a route passing twice by a place keeps its order', () => {
    // Out and back along the same vertices: the end is back at the start.
    const outAndBack: LngLat3[] = [...line, ...line.slice(0, -1).reverse()];
    const points: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 0],
    ];
    // A hit near 0.2 matches the outbound vertex first: segment start to the turn-around.
    expect(insertionIndex(outAndBack, points, [0.2, 0])).toBe(1);
  });

  it('returns null without a route or enough points', () => {
    expect(
      insertionIndex(
        [],
        [
          [0, 0],
          [1, 0],
        ],
        [0.5, 0],
      ),
    ).toBeNull();
    expect(insertionIndex(line, [[0, 0]], [0.5, 0])).toBeNull();
  });
});
