import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import {
  DRAG_START_PX,
  VELOCITY_WINDOW_MS,
  type SheetRelease,
} from './sheet-drag';

/** What a finger must not take from its own job: reorder handles and sliders. */
const KEEP_OUT = '.point-grip, input[type="range"]';

/**
 * A vertical swipe on the scrolling content of a bottom sheet moves the sheet, so that it can be
 * swiped from anywhere. Below its full height every vertical swipe moves it; at full height the
 * content scrolls, except a swipe down that starts with the content at its top, which lowers the
 * sheet. It reports like {@link SheetDrag} (`started`, `moved`, `released`).
 *
 * It listens to touches (a finger only): a touch that scrolls cannot be stopped once the browser
 * has begun, so the first move is the one that decides, and `touchmove` is not passive.
 */
@Directive({ selector: '[vlSheetScrollDrag]' })
export class SheetScrollDrag {
  /** The sheet is at its full height: the content scrolls. */
  readonly sheetFull = input(false);
  readonly started = output<void>();
  readonly moved = output<number>();
  readonly released = output<SheetRelease>();

  private readonly element =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private startY = 0;
  private startX = 0;
  private tracking = false;
  private mode: 'undecided' | 'drag' | 'scroll' = 'undecided';
  private samples: { t: number; y: number }[] = [];

  constructor() {
    const el = this.element;
    const onStart = (event: TouchEvent) => this.start(event);
    const onMove = (event: TouchEvent) => this.move(event);
    const onEnd = (event: TouchEvent) => this.end(event);
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    });
  }

  private start(event: TouchEvent): void {
    const touch = event.touches[0];
    const target = event.target as Element | null;
    // Only a phone has a sheet: a tablet's side panel scrolls as usual.
    const sheet =
      typeof matchMedia !== 'function' ||
      matchMedia('(max-width: 40rem)').matches;
    this.tracking =
      sheet &&
      event.touches.length === 1 &&
      !!touch &&
      !target?.closest?.(KEEP_OUT);
    if (!this.tracking) return;
    this.startY = touch.clientY;
    this.startX = touch.clientX;
    this.mode = 'undecided';
    this.samples = [{ t: event.timeStamp, y: touch.clientY }];
  }

  private move(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!this.tracking || !touch) return;
    if (this.mode === 'undecided') {
      const dy = touch.clientY - this.startY;
      const dx = touch.clientX - this.startX;
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      // A sideways gesture, or a swipe that belongs to the scrolling list.
      const vertical = Math.abs(dy) > Math.abs(dx);
      const lowers = dy > 0 && this.element.scrollTop <= 0;
      this.mode = vertical && (!this.sheetFull() || lowers) ? 'drag' : 'scroll';
      if (this.mode === 'drag') this.started.emit();
    }
    if (this.mode !== 'drag') return;
    if (event.cancelable) event.preventDefault();
    this.samples.push({ t: event.timeStamp, y: touch.clientY });
    this.moved.emit(this.startY - touch.clientY);
  }

  private end(event: TouchEvent): void {
    const wasDragging = this.tracking && this.mode === 'drag';
    this.tracking = false;
    if (!wasDragging) return;
    const last = this.samples[this.samples.length - 1];
    const recent = this.samples.filter(
      (sample) => last.t - sample.t <= VELOCITY_WINDOW_MS,
    );
    const first = recent[0];
    const dt = last.t - first.t;
    this.released.emit({
      up: this.startY - last.y,
      velocity:
        event.type === 'touchcancel' || dt <= 0 ? 0 : (first.y - last.y) / dt,
    });
  }
}
