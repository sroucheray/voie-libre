import { Injectable, computed, inject, signal } from '@angular/core';
import {
  GEOLOCATION,
  type LocationErrorCode,
  type LocationFix,
} from './geolocation';

export type LocationStatus = 'idle' | 'searching' | 'active' | 'error';

/**
 * The user's position, when they share it. It lives in memory only: it is never stored, logged
 * or sent anywhere. `start` asks the browser (which asks the user); `stop` forgets everything.
 */
@Injectable({ providedIn: 'root' })
export class LocationStore {
  private readonly source = inject(GEOLOCATION);
  private stopWatching: (() => void) | null = null;

  readonly support = signal(this.source.support());
  readonly status = signal<LocationStatus>('idle');
  readonly fix = signal<LocationFix | null>(null);
  readonly errorCode = signal<LocationErrorCode | null>(null);

  /** The button can be pressed (the device gives positions). */
  readonly available = computed(() => this.support() === 'ok');
  readonly watching = computed(
    () => this.status() === 'searching' || this.status() === 'active',
  );

  start(): void {
    if (this.watching() || !this.available()) return;
    this.errorCode.set(null);
    this.status.set('searching');
    this.stopWatching = this.source.watch(
      (fix) => {
        this.fix.set(fix);
        this.errorCode.set(null);
        this.status.set('active');
      },
      (code) => this.fail(code),
    );
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.fix.set(null);
    this.errorCode.set(null);
    this.status.set('idle');
  }

  /** Pressing the button while watching stops, otherwise starts. */
  toggle(): void {
    if (this.watching()) this.stop();
    else this.start();
  }

  private fail(code: LocationErrorCode): void {
    // A position we already have stays valid through a hiccup of the device.
    if (this.fix() && code !== 'denied') return;
    if (code === 'denied') {
      this.stopWatching?.();
      this.stopWatching = null;
    }
    this.fix.set(null);
    this.errorCode.set(code);
    this.status.set('error');
  }
}
