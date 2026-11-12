import { Directive, output } from '@angular/core';

export type SwipeDirection = 'up' | 'down';

/** Distance in pixels a finger must travel up or down before it counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 24;

/** `up` or `down` once the vertical travel `dy` (positive downwards) passes the threshold. */
export function swipeDirection(
  dy: number,
  threshold = SWIPE_THRESHOLD_PX,
): SwipeDirection | null {
  if (dy <= -threshold) return 'up';
  if (dy >= threshold) return 'down';
  return null;
}

/**
 * A swipe up or down on the element (finger, pen or mouse), reported once per gesture as soon as it
 * is long enough. A tap that does not travel stays a click; the click that ends a swipe is
 * swallowed, so a swipe on a button never also presses it.
 */
@Directive({
  selector: '[vlVerticalSwipe]',
  host: {
    '[style.touch-action]': '"none"',
    '(pointerdown)': 'start($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'end()',
    '(pointercancel)': 'end()',
  },
})
export class VerticalSwipe {
  /** The direction of the swipe, as soon as the finger has gone far enough. */
  readonly swiped = output<SwipeDirection>();

  private pointer: number | null = null;
  private startY = 0;
  private fired = false;

  protected start(event: PointerEvent): void {
    if (event.button > 0 || this.pointer !== null) return;
    this.pointer = event.pointerId;
    this.startY = event.clientY;
    this.fired = false;
  }

  protected move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer || this.fired) return;
    const direction = swipeDirection(event.clientY - this.startY);
    if (!direction) return;
    this.fired = true;
    this.swiped.emit(direction);
    // The click that follows the release belongs to the swipe, not to a button under the finger.
    const swallow = (click: Event) => {
      click.stopImmediatePropagation();
      click.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 400);
  }

  protected end(): void {
    this.pointer = null;
  }
}
