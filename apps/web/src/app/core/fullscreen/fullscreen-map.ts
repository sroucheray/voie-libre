import { Injectable, signal } from '@angular/core';

/**
 * Whether the map has the whole screen: the header, the offline bar and the planner's sheet are
 * hidden (a phone). Not remembered: a new visit starts with the usual page. No browser full screen
 * API is involved, so it works the same everywhere.
 */
@Injectable({ providedIn: 'root' })
export class FullscreenMap {
  private readonly activeState = signal(false);
  readonly active = this.activeState.asReadonly();

  toggle(): void {
    this.activeState.update((active) => !active);
  }

  exit(): void {
    this.activeState.set(false);
  }
}
