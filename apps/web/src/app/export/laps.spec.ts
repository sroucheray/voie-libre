import {
  MAX_LAPS,
  clampLaps,
  isLoopRoute,
  lapTotals,
  repeatGeometry,
} from './laps';

describe('clampLaps', () => {
  it('keeps a whole number of laps between 1 and the maximum', () => {
    expect(clampLaps(3)).toBe(3);
    expect(clampLaps('4')).toBe(4);
    expect(clampLaps(2.9)).toBe(2);
    expect(clampLaps(0)).toBe(1);
    expect(clampLaps(-5)).toBe(1);
    expect(clampLaps(500)).toBe(MAX_LAPS);
  });

  it('turns anything that is no number into one lap', () => {
    expect(clampLaps('')).toBe(1);
    expect(clampLaps('abc')).toBe(1);
    expect(clampLaps(undefined)).toBe(1);
    expect(clampLaps(Number.NaN)).toBe(1);
  });
});

describe('isLoopRoute', () => {
  it('is true only when the end is exactly on the start', () => {
    expect(
      isLoopRoute([
        [1, 2],
        [3, 4],
        [1, 2],
      ]),
    ).toBe(true);
    expect(
      isLoopRoute([
        [1, 2],
        [3, 4],
      ]),
    ).toBe(false);
    expect(isLoopRoute([[1, 2]])).toBe(false);
  });
});

describe('repeatGeometry', () => {
  const lap: [number, number, number][] = [
    [0, 0, 10],
    [1, 0, 20],
    [1, 1, 30],
    [0, 0, 10],
  ];

  it('is the lap itself for one lap', () => {
    expect(repeatGeometry(lap, 1)).toEqual(lap);
  });

  it('writes the place where a lap ends and the next starts once', () => {
    const three = repeatGeometry(lap, 3);
    expect(three).toHaveLength(4 + 3 + 3);
    expect(three.slice(0, 4)).toEqual(lap);
    expect(three[4]).toEqual(lap[1]);
    expect(three.at(-1)).toEqual(lap[3]);
    // The start of a lap is never a vertex twice in a row.
    for (let i = 1; i < three.length; i++) {
      expect(three[i]).not.toEqual(three[i - 1]);
    }
  });

  it('stops at the maximum number of laps', () => {
    expect(repeatGeometry(lap, 1000)).toHaveLength(1 + 3 * MAX_LAPS);
  });
});

describe('lapTotals', () => {
  it('multiplies the distance and the climb', () => {
    expect(lapTotals({ distanceMeters: 15_000, ascentMeters: 400 }, 3)).toEqual(
      { distanceMeters: 45_000, ascentMeters: 1200 },
    );
  });

  it('keeps an unknown climb unknown', () => {
    expect(
      lapTotals({ distanceMeters: 10_000, ascentMeters: null }, 2),
    ).toEqual({ distanceMeters: 20_000, ascentMeters: null });
  });
});
