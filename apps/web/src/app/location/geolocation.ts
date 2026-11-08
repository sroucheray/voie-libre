import { InjectionToken } from '@angular/core';
import type { LngLat } from '../core/map/map-factory';

/** Where the user is, as reported by the device. */
export interface LocationFix {
  position: LngLat;
  /** Radius in metres of the circle the device is sure to be in. */
  accuracyMeters: number;
  /** Direction of travel in degrees clockwise from north, `null` when unknown or standing still. */
  heading: number | null;
}

/** Stable error codes, translated under `geolocation.errors.*`. */
export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout';

/** Whether the device can give a position at all. */
export type LocationSupport = 'ok' | 'insecure' | 'unavailable';

/**
 * The source of positions. The browser implementation sits below; tests use a fake and a
 * Capacitor plugin can replace it later. Positions never leave the device.
 */
export interface GeolocationSource {
  support(): LocationSupport;
  /** Starts watching; returns the function that stops it. */
  watch(
    onFix: (fix: LocationFix) => void,
    onError: (code: LocationErrorCode) => void,
  ): () => void;
}

/** `GeolocationPositionError.code` to our codes (1 denied, 2 unavailable, 3 timeout). */
export function errorCodeOf(code: number): LocationErrorCode {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

export function fixOf(position: GeolocationPosition): LocationFix {
  const { longitude, latitude, accuracy, heading } = position.coords;
  return {
    position: [longitude, latitude],
    accuracyMeters: accuracy,
    heading: heading !== null && Number.isFinite(heading) ? heading : null,
  };
}

export const browserGeolocation: GeolocationSource = {
  support() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return 'unavailable';
    }
    // Browsers only give a position to secure contexts (HTTPS or localhost).
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
      return 'insecure';
    }
    return 'ok';
  },
  watch(onFix, onError) {
    const id = navigator.geolocation.watchPosition(
      (position) => onFix(fixOf(position)),
      (error) => onError(errorCodeOf(error.code)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  },
};

export const GEOLOCATION = new InjectionToken<GeolocationSource>(
  'GEOLOCATION',
  { providedIn: 'root', factory: () => browserGeolocation },
);
