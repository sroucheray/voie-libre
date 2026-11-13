import {
  nextState,
  sheetHeights,
  snapTo,
  stepState,
  FLICK_SPEED,
} from './sheet-snap';

const heights = sheetHeights(600, 70);

describe('sheet snapping', () => {
  it('gives the three heights from the stage', () => {
    expect(heights).toEqual({ peek: 70, half: 300, full: 600 });
    expect(sheetHeights(100, 70).half).toBe(70);
  });

  it('settles on the nearest height after a slow release', () => {
    expect(snapTo(120, 0, heights, 'peek')).toBe('peek');
    expect(snapTo(200, 0.1, heights, 'peek')).toBe('half');
    expect(snapTo(480, 0, heights, 'half')).toBe('full');
  });

  it('goes to the next height in the direction of a flick, even a short one', () => {
    expect(snapTo(90, FLICK_SPEED, heights, 'peek')).toBe('half');
    expect(snapTo(280, -FLICK_SPEED, heights, 'half')).toBe('peek');
    expect(snapTo(580, FLICK_SPEED, heights, 'full')).toBe('full');
    expect(snapTo(80, -FLICK_SPEED, heights, 'peek')).toBe('peek');
  });

  it('cycles on a tap and steps with the arrow keys', () => {
    expect(nextState('peek')).toBe('half');
    expect(nextState('full')).toBe('peek');
    expect(stepState('half', true)).toBe('full');
    expect(stepState('full', true)).toBe('full');
    expect(stepState('peek', false)).toBe('peek');
  });
});
