/**
 * How long after the last touch a map event still comes from that touch. A tap ends well under a
 * second after it starts; a long press (600 ms) with a little slack for the browser's own delay.
 */
export const TOUCH_GESTURE_MS = 1500;

/**
 * A long press often reports itself twice (the map's own event, then the browser's, on whatever is
 * under the finger by then). For this long after a point was put, nothing else counts: the second
 * report must neither put another point nor remove the one just put (a context menu on a marker
 * removes it).
 */
export const PLACEMENT_SETTLE_MS = 1500;

/** `now` is too soon after a point was put at `placedAt` (both in ms) for another long press. */
export function isPlacementSettling(placedAt: number, now: number): boolean {
  return now - placedAt < PLACEMENT_SETTLE_MS;
}

/** The event at `now` belongs to a finger that touched the map at `lastTouchAt` (both in ms). */
export function isTouchGesture(lastTouchAt: number, now: number): boolean {
  return now - lastTouchAt < TOUCH_GESTURE_MS;
}
