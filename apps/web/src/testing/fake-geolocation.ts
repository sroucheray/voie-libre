import {
  GEOLOCATION,
  type GeolocationSource,
  type LocationErrorCode,
  type LocationFix,
  type LocationSupport,
} from '../app/location/geolocation';

/** A position source driven by the test: `emit` and `fail` play what the device would do. */
export class FakeGeolocation implements GeolocationSource {
  supported: LocationSupport = 'ok';
  watching = false;
  starts = 0;
  private onFix: ((fix: LocationFix) => void) | null = null;
  private onError: ((code: LocationErrorCode) => void) | null = null;

  support() {
    return this.supported;
  }

  watch(
    onFix: (fix: LocationFix) => void,
    onError: (code: LocationErrorCode) => void,
  ) {
    this.watching = true;
    this.starts++;
    this.onFix = onFix;
    this.onError = onError;
    return () => {
      this.watching = false;
    };
  }

  emit(fix: Partial<LocationFix> = {}) {
    this.onFix?.({
      position: [3.08, 45.78],
      accuracyMeters: 25,
      heading: null,
      ...fix,
    });
  }

  fail(code: LocationErrorCode) {
    this.onError?.(code);
  }
}

export function provideFakeGeolocation(fake: FakeGeolocation) {
  return { provide: GEOLOCATION, useValue: fake };
}
