import { TestBed } from '@angular/core/testing';
import { DEFAULT_SPEEDS_KMH } from './loop-duration';
import { LOOP_SPEEDS_KEY, LoopSpeeds } from './loop-speeds';

describe('LoopSpeeds', () => {
  beforeEach(() => localStorage.removeItem(LOOP_SPEEDS_KEY));
  afterEach(() => localStorage.removeItem(LOOP_SPEEDS_KEY));

  it('uses the default of the profile until the user chooses', () => {
    const speeds = TestBed.inject(LoopSpeeds);
    expect(speeds.speed('trail')).toBe(DEFAULT_SPEEDS_KMH.trail);
  });

  it('keeps a speed per profile on the device', () => {
    TestBed.inject(LoopSpeeds).set('gravel', 19);
    TestBed.resetTestingModule();
    const speeds = TestBed.inject(LoopSpeeds);
    expect(speeds.speed('gravel')).toBe(19);
    expect(speeds.speed('road')).toBe(DEFAULT_SPEEDS_KMH.road);
  });

  it('ignores a stored value that is not a speed', () => {
    localStorage.setItem(LOOP_SPEEDS_KEY, '{"road":"fast"}');
    expect(TestBed.inject(LoopSpeeds).speed('road')).toBe(
      DEFAULT_SPEEDS_KMH.road,
    );
  });
});
