import { Injectable, effect, inject, untracked } from '@angular/core';
import { API_CLIENT } from '../core/api/api-client';
import {
  PlannedRoute,
  PlannerErrorCode,
  PlannerStore,
  inputsSignature,
  type LoopMode,
  type Profile,
} from './planner-store';
import type { LngLat } from '../core/map/map-factory';

/** Wait for the user to stop editing before calling the API. */
export const ROUTE_DEBOUNCE_MS = 300;

const API_ERROR_CODES: readonly PlannerErrorCode[] = [
  'invalid_request',
  'no_route',
  'unavailable',
  'provider_error',
];

/** Maps an HTTP status and an error body to a code the UI translates. */
export function errorCodeFrom(status: number, body: unknown): PlannerErrorCode {
  if (status === 429) return 'rate_limited';
  // The service worker answers 504 for a request the network could not carry (offline).
  if (status === 504) return 'unavailable';
  const code = (body as { code?: unknown } | undefined)?.code;
  return API_ERROR_CODES.find((known) => known === code) ?? 'unknown';
}

/**
 * Recomputes the route whenever the points, the profile or the number of alternatives change.
 * A route restored from the device is already in the store: it is skipped, until the inputs
 * change. A short debounce groups quick edits, and a newer change aborts the request still in flight.
 */
@Injectable({ providedIn: 'root' })
export class RoutePlanner {
  private readonly store = inject(PlannerStore);
  private readonly client = inject(API_CLIENT);

  constructor() {
    effect((onCleanup) => {
      const points = this.store.points();
      const profile = this.store.profile();
      const alternatives = this.store.alternatives();
      const loop = this.store.loop();

      if (points.length < 2) {
        untracked(() => {
          this.store.forgetRestored();
          this.store.resetResult();
        });
        return;
      }
      const signature = inputsSignature(points, profile, alternatives, loop);
      if (untracked(() => this.store.isRestored(signature))) return;
      untracked(() => this.store.forgetRestored());
      untracked(() => this.store.startLoading());
      const controller = new AbortController();
      const timer = setTimeout(
        () =>
          void this.compute(
            points,
            profile,
            alternatives,
            loop,
            controller.signal,
          ),
        ROUTE_DEBOUNCE_MS,
      );
      onCleanup(() => {
        clearTimeout(timer);
        controller.abort();
      });
    });
  }

  private async compute(
    points: LngLat[],
    profile: Profile,
    alternatives: number,
    loop: LoopMode | null,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const { data, error, response } = await this.client.POST('/route', {
        body: {
          points: points.map(([lon, lat]) => ({ lon, lat })),
          profile,
          alternatives,
          ...(loop ? { loop } : {}),
        },
        signal,
      });
      if (signal.aborted) return;
      if (data) {
        // The compiler widens the generated `[lon, lat, ele]` tuples to number[]: restore them.
        // BRouter's elevations come from SRTM, which asks to be credited.
        this.store.setRoutes(
          (data.routes as PlannedRoute[]).map((route) => ({
            ...route,
            elevationSource: 'srtm' as const,
          })),
        );
      } else {
        this.store.setError(errorCodeFrom(response.status, error));
      }
    } catch {
      // An aborted request is superseded by a newer one: nothing to report.
      if (!signal.aborted) this.store.setError('unavailable');
    }
  }
}
