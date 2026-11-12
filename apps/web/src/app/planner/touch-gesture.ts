/**
 * How long after the last touch a map event still comes from that touch. A tap ends well under a
 * second after it starts; a long press (600 ms) with a little slack for the browser's own delay.
 */
export const TOUCH_GESTURE_MS = 1500;

/** The event at `now` belongs to a finger that touched the map at `lastTouchAt` (both in ms). */
export function isTouchGesture(lastTouchAt: number, now: number): boolean {
  return now - lastTouchAt < TOUCH_GESTURE_MS;
}
