import { Injectable, signal } from '@angular/core';
import { PROFILES, type Profile } from './planner-store';

/** Where the choices are kept on the device. */
export const DESCENT_COLOURS_KEY = 'voie-libre.descent-colours';

/**
 * Whether the descents of the elevation profile are coloured by their steepness, for each profile.
 * Riders read the colours as the effort of the climbs, so road and gravel leave the descents
 * neutral; trail, where steep descents matter, colours them. A setting kept on the device
 * (`localStorage`), never sent.
 */
@Injectable({ providedIn: 'root' })
export class DescentColours {
  private readonly chosen = signal<Partial<Record<Profile, boolean>>>(
    this.read(),
  );

  /** Whether the descents of this profile are coloured. */
  coloured(profile: Profile): boolean {
    return this.chosen()[profile] ?? profile === 'trail';
  }

  set(profile: Profile, value: boolean): void {
    this.chosen.update((choices) => ({ ...choices, [profile]: value }));
    try {
      localStorage.setItem(DESCENT_COLOURS_KEY, JSON.stringify(this.chosen()));
    } catch {
      // Storage refused (private window): the choice holds until the page is closed.
    }
  }

  private read(): Partial<Record<Profile, boolean>> {
    try {
      const stored = JSON.parse(
        localStorage.getItem(DESCENT_COLOURS_KEY) ?? '{}',
      );
      const choices: Partial<Record<Profile, boolean>> = {};
      for (const profile of PROFILES) {
        if (typeof stored?.[profile] === 'boolean') {
          choices[profile] = stored[profile];
        }
      }
      return choices;
    } catch {
      return {};
    }
  }
}
