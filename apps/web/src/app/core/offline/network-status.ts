import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/** Whether the browser thinks it has a network (a hint: `true` does not prove a server answers). */
@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly onlineState = signal(this.window?.navigator.onLine ?? true);
  readonly online = this.onlineState.asReadonly();

  constructor() {
    this.window?.addEventListener('online', () => this.onlineState.set(true));
    this.window?.addEventListener('offline', () => this.onlineState.set(false));
  }
}
