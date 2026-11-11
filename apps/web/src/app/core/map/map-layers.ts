import { Injectable, InjectionToken, signal } from '@angular/core';

/** Where the choice of layers is kept on the device. */
export const MAP_LAYERS_KEY = 'voie-libre.map-layers';

/**
 * The overlays the user wants on the map. A display preference: kept on the device
 * (`localStorage`), never sent. The relief is on until the user turns it off.
 */
@Injectable({ providedIn: 'root' })
export class MapLayers {
  private readonly reliefState = signal(this.read().relief ?? true);
  private readonly waysState = signal(this.read().ways ?? false);
  private readonly surfaceState = signal(this.read().surface ?? false);
  private readonly imageryState = signal(this.read().imagery ?? false);
  /** True when the user wants the hillshade. */
  readonly relief = this.reliefState.asReadonly();
  /** True when the user wants the ways coloured by how well they suit the profile (off at first). */
  readonly ways = this.waysState.asReadonly();
  /** True when the user wants the route coloured by what it rides on (off at first). */
  readonly surface = this.surfaceState.asReadonly();
  /** True when the user wants the IGN's aerial photos (off at first: it calls an external server). */
  readonly imagery = this.imageryState.asReadonly();

  setRelief(shown: boolean): void {
    this.reliefState.set(shown);
    this.save();
  }

  setWays(shown: boolean): void {
    this.waysState.set(shown);
    this.save();
  }

  setSurface(shown: boolean): void {
    this.surfaceState.set(shown);
    this.save();
  }

  setImagery(shown: boolean): void {
    this.imageryState.set(shown);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(
        MAP_LAYERS_KEY,
        JSON.stringify({
          relief: this.reliefState(),
          ways: this.waysState(),
          surface: this.surfaceState(),
          imagery: this.imageryState(),
        }),
      );
    } catch {
      // Storage refused (private window): the choice holds until the page is closed.
    }
  }

  private read(): {
    relief?: boolean;
    ways?: boolean;
    surface?: boolean;
    imagery?: boolean;
  } {
    try {
      const stored = JSON.parse(localStorage.getItem(MAP_LAYERS_KEY) ?? '{}');
      return {
        ...(typeof stored?.relief === 'boolean'
          ? { relief: stored.relief }
          : {}),
        ...(typeof stored?.ways === 'boolean' ? { ways: stored.ways } : {}),
        ...(typeof stored?.surface === 'boolean'
          ? { surface: stored.surface }
          : {}),
        ...(typeof stored?.imagery === 'boolean'
          ? { imagery: stored.imagery }
          : {}),
      };
    } catch {
      return {};
    }
  }
}

/** Says whether a file of the tiles server exists, without downloading it. */
export type FileProbe = (url: string) => Promise<boolean>;

/** A `HEAD` request: false when the file is missing or the server cannot be reached. */
export const probeWithHead: FileProbe = async (url) => {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
};

/** Replaced in tests, which have no tiles server. */
export const RELIEF_PROBE = new InjectionToken<FileProbe>('RELIEF_PROBE', {
  providedIn: 'root',
  factory: () => probeWithHead,
});
