import {
  DEFAULT_SPEEDS_KMH,
  distanceFor,
  durationFor,
  sanitizeSpeed,
} from './loop-duration';

describe('loop duration', () => {
  it('turns a duration into a distance with the speed', () => {
    expect(distanceFor(60, 22)).toBe(22_000);
    expect(distanceFor(180, 17)).toBe(51_000);
    expect(distanceFor(60, 8)).toBe(8_000);
  });

  it('turns a distance into a duration with the speed', () => {
    expect(durationFor(22_000, 22)).toBe(3600);
    expect(durationFor(8_000, 16)).toBe(1800);
  });

  it('keeps the speed in range and falls back to the default of the profile', () => {
    expect(sanitizeSpeed('abc', 'trail')).toBe(DEFAULT_SPEEDS_KMH.trail);
    expect(sanitizeSpeed(0, 'road')).toBe(DEFAULT_SPEEDS_KMH.road);
    expect(sanitizeSpeed(500, 'road')).toBe(60);
    expect(sanitizeSpeed(1, 'road')).toBe(3);
    expect(sanitizeSpeed('18.5', 'gravel')).toBe(18.5);
  });
});
