import {
  GRADE_BANDS,
  buildProfile,
  gradeBand,
  gradeRuns,
  sampleAtDistance,
  sampleNearest,
  stretchStats,
} from './elevation-profile';
import type { LngLat3 } from './planner-map-driver';

/** About 111 m per 0.001° of latitude, climbing 10 m each step: a 9 % grade. */
const climb: LngLat3[] = Array.from({ length: 11 }, (_, i) => [
  3,
  45 + i * 0.001,
  100 + i * 10,
]);

describe('buildProfile', () => {
  it('needs at least two points and a non-zero length', () => {
    expect(buildProfile([])).toBeNull();
    expect(buildProfile([[3, 45, 100]])).toBeNull();
    expect(
      buildProfile([
        [3, 45, 100],
        [3, 45, 120],
      ]),
    ).toBeNull();
  });

  it('accumulates the distance and tracks the extremes', () => {
    const profile = buildProfile(climb)!;
    expect(profile.samples).toHaveLength(11);
    expect(profile.samples[0].distance).toBe(0);
    expect(profile.totalDistance).toBeGreaterThan(1100);
    expect(profile.totalDistance).toBeLessThan(1120);
    expect(profile.minElevation).toBe(100);
    expect(profile.maxElevation).toBe(200);
    expect(profile.samples[10].index).toBe(10);
  });

  it('measures the grade over a short window', () => {
    const profile = buildProfile(climb)!;
    for (const sample of profile.samples) {
      expect(sample.grade).toBeGreaterThan(8);
      expect(sample.grade).toBeLessThan(10);
    }
  });

  it('reports a negative grade going down and zero on the flat', () => {
    const down = buildProfile([...climb].reverse())!;
    expect(down.samples[5].grade).toBeLessThan(-8);
    const flat = buildProfile(climb.map(([lon, lat]) => [lon, lat, 50]))!;
    expect(flat.samples[5].grade).toBe(0);
  });
});

describe('sampleAtDistance', () => {
  const profile = buildProfile(climb)!;

  it('picks the closest sample, clamped to both ends', () => {
    expect(sampleAtDistance(profile, -50).index).toBe(0);
    expect(sampleAtDistance(profile, profile.totalDistance + 50).index).toBe(
      10,
    );
    expect(
      sampleAtDistance(profile, profile.samples[4].distance + 5).index,
    ).toBe(4);
  });
});

describe('sampleNearest', () => {
  it('finds the sample closest to a map position', () => {
    const profile = buildProfile(climb)!;
    expect(sampleNearest(profile, [3.0001, 45.0071]).index).toBe(7);
  });
});

describe('grade bands and stretches', () => {
  // 100 m steps (about 0.0009 degrees of latitude); climbs 0, 4, 4, 12, then drops 20 m.
  const step = 100 / 111_195;
  const elevations = [100, 100, 104, 108, 120, 100];
  const profile = buildProfile(
    elevations.map((elevation, i) => [3, 45 + i * step, elevation]),
  )!;

  it('puts a grade in the band of its steepness, up or down', () => {
    expect(gradeBand(0)).toBe(0);
    expect(gradeBand(2.9)).toBe(0);
    expect(gradeBand(3)).toBe(1);
    expect(gradeBand(-7)).toBe(2);
    expect(gradeBand(12)).toBe(3);
    expect(gradeBand(-40)).toBe(GRADE_BANDS.length - 1);
  });

  it('cuts the profile into runs that follow one another', () => {
    const runs = gradeRuns(profile);
    expect(runs[0].from).toBe(0);
    expect(runs[runs.length - 1].to).toBe(elevations.length - 1);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].from).toBe(runs[i - 1].to);
      expect(runs[i].band).not.toBe(runs[i - 1].band);
    }
    expect(runs.length).toBeGreaterThan(1);
  });

  it('adds up a stretch, in either order', () => {
    const stats = stretchStats(profile, 4, 1);
    expect(stats.distance).toBeCloseTo(300, 0);
    expect(stats.ascent).toBe(20);
    expect(stats.descent).toBe(0);
    expect(stats.grade).toBeCloseTo(6.67, 1);
    expect(stretchStats(profile, 1, 4)).toEqual(stats);
  });

  it('counts the way down and ignores small wobbles', () => {
    const whole = stretchStats(profile, 0, 5);
    expect(whole.ascent).toBe(20);
    expect(whole.descent).toBe(20);
    expect(whole.grade).toBeCloseTo(0, 5);

    const wobbly = buildProfile(
      [100, 102, 100, 101, 99].map((elevation, i) => [
        3,
        45 + i * step,
        elevation,
      ]),
    )!;
    expect(stretchStats(wobbly, 0, 4)).toMatchObject({ ascent: 0, descent: 0 });
  });
});
