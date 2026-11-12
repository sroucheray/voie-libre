import { swipeDirection } from './vertical-swipe';

describe('swipeDirection', () => {
  it('is up or down once the finger has gone far enough', () => {
    expect(swipeDirection(-30)).toBe('up');
    expect(swipeDirection(30)).toBe('down');
  });

  it('is nothing for a tap or a small wobble', () => {
    expect(swipeDirection(0)).toBeNull();
    expect(swipeDirection(-10)).toBeNull();
    expect(swipeDirection(23)).toBeNull();
  });

  it('counts exactly the threshold, and takes another one', () => {
    expect(swipeDirection(-24)).toBe('up');
    expect(swipeDirection(24)).toBe('down');
    expect(swipeDirection(-40, 50)).toBeNull();
  });
});
