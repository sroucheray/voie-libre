import { Directive, output } from '@angular/core';

/** Distance in pixels a pointer must travel before the gesture is a drag and not a tap. */
export const DRAG_START_PX = 6;

/** Time in milliseconds over which the speed of the release is measured. */
export const VELOCITY_WINDOW_MS = 100;

export interface SheetRelease {
  /** Total travel since the start, in pixels, positive going up. */
  up: number;
  /** Speed at the release in px/ms, positive going up. */
  velocity: number;
}

/**
 * A drag on the handle of a bottom sheet (finger, pen or mouse). It reports the travel while the
 * pointer moves (`moved`, positive going up) and the release with its speed (`released`). A tap that
 * does not travel stays a click; the click that ends a drag is swallowed.
 */
@Directive({
  selector: '[vlSheetDrag]',
  host: {
    '[style.touch-action]': '"none"',
    '(pointerdown)': 'start($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'end($event)',
    '(pointercancel)': 'end($event)',
  },
})
export class SheetDrag {
  /** A drag has begun. */
  readonly started = output<void>();
  /** The travel since the start while dragging, in pixels, positive going up. */
  readonly moved = output<number>();
  /** The drag ended: the travel and the speed. */
  readonly released = output<SheetRelease>();

  private pointer: number | null = null;
  private startY = 0;
  private dragging = false;
  private samples: { t: number; y: number }[] = [];

  protected start(event: PointerEvent): void {
    if (event.button > 0 || this.pointer !== null) return;
    this.pointer = event.pointerId;
    this.startY = event.clientY;
    this.dragging = false;
    this.samples = [{ t: event.timeStamp, y: event.clientY }];
  }

  protected move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    if (!this.dragging) {
      if (Math.abs(event.clientY - this.startY) < DRAG_START_PX) return;
      this.dragging = true;
      try {
        (event.currentTarget as Element | null)?.setPointerCapture?.(
          event.pointerId,
        );
      } catch {
        // No active pointer to capture (a synthetic event): the drag goes on without it.
      }
      this.started.emit();
    }
    this.samples.push({ t: event.timeStamp, y: event.clientY });
    this.moved.emit(this.startY - event.clientY);
  }

  protected end(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    this.pointer = null;
    if (!this.dragging) return;
    this.dragging = false;
    this.released.emit({
      up: this.startY - event.clientY,
      velocity: event.type === 'pointercancel' ? 0 : this.velocity(event),
    });
    // The click that follows the release belongs to the drag, not to the handle.
    const swallow = (click: Event) => {
      click.stopImmediatePropagation();
      click.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 400);
  }

  private velocity(event: PointerEvent): number {
    const recent = this.samples.filter(
      (sample) => event.timeStamp - sample.t <= VELOCITY_WINDOW_MS,
    );
    const first = recent[0];
    const dt = first ? event.timeStamp - first.t : 0;
    return first && dt > 0 ? (first.y - event.clientY) / dt : 0;
  }
}
