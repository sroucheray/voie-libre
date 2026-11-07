import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** Reloads the page; replaced in tests, since jsdom cannot reload. */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return () => document.location.reload();
  },
});

/**
 * Tells when a new version of the app is downloaded and waiting. The service worker keeps serving
 * the previous version until the page is reloaded, so without this a user (or a shared link
 * opened right after a release) would run the old app for one more visit.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  /** Absent when the service worker is not provided at all (tests). */
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly reload = inject(RELOAD_PAGE);
  private readonly readyState = signal(false);
  /** True once a new version is ready to be activated. */
  readonly ready = this.readyState.asReadonly();

  constructor() {
    // The service worker only runs in the production build.
    if (!this.updates?.isEnabled) return;
    this.updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.readyState.set(true);
    });
  }

  /** Switches to the new version and reloads the page. */
  async apply(): Promise<void> {
    try {
      await this.updates?.activateUpdate();
    } catch {
      // Reloading is still the best way to reach the new version.
    }
    this.reload();
  }

  dismiss(): void {
    this.readyState.set(false);
  }
}
