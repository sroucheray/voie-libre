import {
  PLACEMENT_SETTLE_MS,
  TOUCH_GESTURE_MS,
  isPlacementSettling,
  isTouchGesture,
} from './touch-gesture';

describe('isTouchGesture', () => {
  it('is true for the events that follow a touch closely', () => {
    expect(isTouchGesture(1000, 1100)).toBe(true);
    expect(isTouchGesture(1000, 1000 + TOUCH_GESTURE_MS - 1)).toBe(true);
  });

  it('is false for a mouse a while after a touch, and when nothing touched the map', () => {
    expect(isTouchGesture(1000, 1000 + TOUCH_GESTURE_MS)).toBe(false);
    expect(isTouchGesture(Number.NEGATIVE_INFINITY, 5000)).toBe(false);
  });
});

describe('isPlacementSettling', () => {
  it('is true just after a point was put, so the same press cannot remove or add again', () => {
    expect(isPlacementSettling(1000, 1000)).toBe(true);
    expect(isPlacementSettling(1000, 1000 + PLACEMENT_SETTLE_MS - 1)).toBe(
      true,
    );
  });

  it('is false later, and before any point was put', () => {
    expect(isPlacementSettling(1000, 1000 + PLACEMENT_SETTLE_MS)).toBe(false);
    expect(isPlacementSettling(Number.NEGATIVE_INFINITY, 5000)).toBe(false);
  });
});
