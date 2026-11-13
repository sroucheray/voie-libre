import { TestBed } from '@angular/core/testing';
import { DESCENT_COLOURS_KEY, DescentColours } from './descent-colours';

describe('DescentColours', () => {
  beforeEach(() => localStorage.removeItem(DESCENT_COLOURS_KEY));
  afterEach(() => localStorage.removeItem(DESCENT_COLOURS_KEY));

  it('colours the descents of trail only, until the user chooses', () => {
    const colours = TestBed.inject(DescentColours);
    expect(colours.coloured('trail')).toBe(true);
    expect(colours.coloured('road')).toBe(false);
    expect(colours.coloured('gravel')).toBe(false);
  });

  it('keeps a choice per profile on the device', () => {
    TestBed.inject(DescentColours).set('gravel', true);
    TestBed.inject(DescentColours).set('trail', false);
    TestBed.resetTestingModule();
    const colours = TestBed.inject(DescentColours);
    expect(colours.coloured('gravel')).toBe(true);
    expect(colours.coloured('trail')).toBe(false);
    expect(colours.coloured('road')).toBe(false);
  });

  it('ignores a stored value that is not a choice', () => {
    localStorage.setItem(DESCENT_COLOURS_KEY, '{"trail":"no"}');
    expect(TestBed.inject(DescentColours).coloured('trail')).toBe(true);
  });
});
