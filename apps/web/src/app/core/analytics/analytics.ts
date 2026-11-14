import {
  Injectable,
  InjectionToken,
  Injector,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { API_CLIENT } from '../api/api-client';
import { LanguageService } from '../i18n/language.service';

/** Whether the counters are on at all: never in development, so that testing counts for nothing. */
export const ANALYTICS_ENABLED = new InjectionToken<boolean>(
  'ANALYTICS_ENABLED',
  { providedIn: 'root', factory: () => !isDevMode() },
);

/** Where the visitor's choice "do not count my visits" is remembered, on the device only. */
export const ANALYTICS_OFF_KEY = 'voie-libre.analytics-off';

/** What a page may report: see `POST /stats`. Nothing here names a place or a route. */
export type AnalyticsEvent =
  | { event: 'visit' }
  | {
      event: 'route';
      profile: 'road' | 'gravel' | 'trail';
      kilometers: number;
      points: number;
      stops: number;
    }
  | { event: 'loop' | 'export_gpx' | 'export_fit' | 'save' };

type Device = 'phone' | 'tablet' | 'desktop';

/** The size of the window, in CSS pixels: the only thing used to tell a device class. */
export function deviceClass(width: number): Device {
  if (width <= 640) return 'phone';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

/**
 * Counts visits and the use of a few features, in aggregate (see `docs/features/analytics.md`).
 * Sends no identifier and keeps nothing on the device but the visitor's refusal. Silent when the
 * visitor refused, when the browser says Do Not Track or Global Privacy Control, and when offline.
 */
@Injectable({ providedIn: 'root' })
export class Analytics {
  private readonly injector = inject(Injector);
  private readonly enabled = inject(ANALYTICS_ENABLED);
  private readonly offState = signal(this.storedOff());

  /** True when the visitor asked not to be counted. */
  readonly off = this.offState.asReadonly();

  setOff(off: boolean): void {
    this.offState.set(off);
    try {
      if (off) localStorage.setItem(ANALYTICS_OFF_KEY, '1');
      else localStorage.removeItem(ANALYTICS_OFF_KEY);
    } catch {
      // Storage refused: the choice holds until the page is closed.
    }
  }

  /** Reports an event; never throws and never waits. */
  report(event: AnalyticsEvent): void {
    if (!this.enabled || this.offState() || this.refusedByBrowser()) return;
    const body =
      event.event === 'visit'
        ? {
            event: 'visit' as const,
            language: this.injector.get(LanguageService).current(),
            device: deviceClass(window.innerWidth),
          }
        : event;
    try {
      void this.injector
        .get(API_CLIENT)
        .POST('/stats', { body })
        .catch(() => undefined);
    } catch {
      // Counting must never get in the way of the app.
    }
  }

  private refusedByBrowser(): boolean {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    return navigator.doNotTrack === '1' || nav.globalPrivacyControl === true;
  }

  private storedOff(): boolean {
    try {
      return localStorage.getItem(ANALYTICS_OFF_KEY) === '1';
    } catch {
      return false;
    }
  }
}
