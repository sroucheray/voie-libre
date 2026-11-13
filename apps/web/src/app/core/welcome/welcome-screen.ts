import { Injectable, signal } from '@angular/core';

/** Where the welcome screen remembers that the visitor has seen it. */
export const WELCOME_SEEN_KEY = 'voie-libre.welcome-seen';

/**
 * Whether the welcome screen is on show. It opens by itself on the first visit; closing it is
 * remembered on the device (`localStorage`, never sent) and the About window can bring it back.
 */
@Injectable({ providedIn: 'root' })
export class WelcomeScreen {
  private readonly openState = signal(!this.seen());
  readonly open = this.openState.asReadonly();

  show(): void {
    this.openState.set(true);
  }

  dismiss(): void {
    this.openState.set(false);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, '1');
    } catch {
      // Storage refused (private window): it shows again on the next visit.
    }
  }

  private seen(): boolean {
    try {
      return localStorage.getItem(WELCOME_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }
}
