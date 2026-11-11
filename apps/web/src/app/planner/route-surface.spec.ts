import { buildProfile } from './elevation-profile';
import {
  SURFACE_COLORS,
  SURFACE_CODES,
  surfaceKey,
  surfaceRuns,
  surfaceShares,
} from './route-surface';

describe('surfaceRuns', () => {
  it('cuts the codes into runs that end on the vertex the next one starts at', () => {
    expect(surfaceRuns('ppuus')).toEqual([
      { code: 'p', from: 0, to: 2 },
      { code: 'u', from: 2, to: 4 },
      { code: 's', from: 4, to: 5 },
    ]);
  });

  it('counts a character it does not know as unknown', () => {
    expect(surfaceRuns('px')).toEqual([
      { code: 'p', from: 0, to: 1 },
      { code: '?', from: 1, to: 2 },
    ]);
  });

  it('has no run without codes', () => {
    expect(surfaceRuns('')).toEqual([]);
  });
});

describe('surfaceShares', () => {
  // Five vertices, 0.001° apart on a meridian: four segments of about 111 m.
  const profile = buildProfile(
    Array.from({ length: 5 }, (_, i) => [3, 45 + i * 0.001, 100]),
  )!;

  it('adds up the distance of each category, in the order of the legend', () => {
    const shares = surfaceShares(profile, 'upcp');
    expect(shares.map((s) => s.code)).toEqual(['p', 'c', 'u']);
    expect(shares[0].share).toBeCloseTo(0.5, 2);
    expect(shares[1].share).toBeCloseTo(0.25, 2);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 5);
    expect(shares[0].meters).toBeCloseTo(profile.totalDistance / 2, 3);
  });

  it('is empty when the codes do not fit the profile', () => {
    expect(surfaceShares(profile, 'ppp')).toEqual([]);
  });
});

describe('categories', () => {
  it('has a colour and a translation key for each code', () => {
    for (const code of SURFACE_CODES) {
      expect(SURFACE_COLORS[code]).toMatch(/^#[0-9a-f]{6}$/);
      expect(surfaceKey(code)).toMatch(/^surface\.[a-z]+$/);
    }
    expect(surfaceKey('?')).toBe('surface.unknown');
  });
});
