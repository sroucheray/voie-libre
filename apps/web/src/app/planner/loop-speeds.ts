import { Injectable, signal } from '@angular/core';
import { DEFAULT_SPEEDS_KMH, sanitizeSpeed } from './loop-duration';
import { PROFILES, type Profile } from './planner-store';

/** Where the speeds are kept on the device. */
export const LOOP_SPEEDS_KEY = 'voie-libre.loop-speeds';

/**
 * The speed of the user for each profile, used to turn the duration of a loop into a distance.
 * A setting kept on the device (`localStorage`), never sent; a profile without a choice uses its default.
 */
@Injectable({ providedIn: 'root' })
export class LoopSpeeds {
  private readonly chosen = signal<Partial<Record<Profile, number>>>(
    this.read(),
  );

  /** The speed in km/h of a profile. */
  speed(profile: Profile): number {
    return this.chosen()[profile] ?? DEFAULT_SPEEDS_KMH[profile];
  }

  set(profile: Profile, value: unknown): void {
    this.chosen.update((speeds) => ({
      ...speeds,
      [profile]: sanitizeSpeed(value, profile),
    }));
    try {
      localStorage.setItem(LOOP_SPEEDS_KEY, JSON.stringify(this.chosen()));
    } catch {
      // Storage refused (private window): the choice holds until the page is closed.
    }
  }

  private read(): Partial<Record<Profile, number>> {
    try {
      const stored = JSON.parse(localStorage.getItem(LOOP_SPEEDS_KEY) ?? '{}');
      const speeds: Partial<Record<Profile, number>> = {};
      for (const profile of PROFILES) {
        if (typeof stored?.[profile] === 'number') {
          speeds[profile] = sanitizeSpeed(stored[profile], profile);
        }
      }
      return speeds;
    } catch {
      return {};
    }
  }
}
