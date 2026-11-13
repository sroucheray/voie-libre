import { Injectable, signal } from '@angular/core';

/** Whether the "About" window is on show: the header button and the phone menu both open it. */
@Injectable({ providedIn: 'root' })
export class AboutScreen {
  private readonly openState = signal(false);
  readonly open = this.openState.asReadonly();

  show(): void {
    this.openState.set(true);
  }

  close(): void {
    this.openState.set(false);
  }
}
