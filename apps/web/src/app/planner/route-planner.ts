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
import { planLocalEdit, type LocalEditPlan } from './local-edit';
import type { LngLat3 } from './planner-map-driver';

/** Wait for the user to stop editing before calling the API. */
export const ROUTE_DEBOUNCE_MS = 300;

/** A stretch to recompute, and the route it is cut from. */
interface LocalWork {
  plan: LocalEditPlan;
  route: PlannedRoute;
}

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
 *
 * A point added, moved or removed on a route that is on screen only recomputes a short stretch
 * around it (see `local-edit.ts`), so that the rest of the route, a loop for instance, is kept.
 * Everything else computes the whole route: the profile or the alternatives changed, the route is
 * not up to date with the points (still loading, or in error), or the edit has no local form.
 */
@Injectable({ providedIn: 'root' })
export class RoutePlanner {
  private readonly store = inject(PlannerStore);
  private readonly client = inject(API_CLIENT);

  /** The points the last run of the effect saw, to tell a change of points from another one. */
  private seenPoints: LngLat[] | null = null;

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
      const local = untracked(() => this.localPlan(points));
      untracked(() => this.store.startLoading());
      const controller = new AbortController();
      // A drag on the map paces its own changes (see `Planner`): no need to wait for it to stop.
      const delay = untracked(() => this.store.dragging())
        ? 0
        : ROUTE_DEBOUNCE_MS;
      const timer = setTimeout(
        () =>
          void (local
            ? this.computeLocal(local, profile, controller.signal)
            : this.compute(
                points,
                profile,
                alternatives,
                loop,
                controller.signal,
              )),
        delay,
      );
      onCleanup(() => {
        clearTimeout(timer);
        controller.abort();
      });
    });
  }

  /**
   * The stretch to recompute when `points` come from a single edit of a route that is up to date
   * with the previous points (during a drag: with the points the drag started from), else `null`.
   */
  private localPlan(points: LngLat[]): LocalWork | null {
    const changed = points !== this.seenPoints;
    this.seenPoints = points;
    if (!changed) return null;
    const edit = this.store.editBehind(points);
    const route = this.store.routeBehind(points);
    if (!edit || !route) return null;
    const plan = planLocalEdit(route.geometry, edit);
    return plan ? { plan, route } : null;
  }

  private async computeLocal(
    { plan, route }: LocalWork,
    profile: Profile,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const { data, error, response } = await this.client.POST('/route', {
        body: {
          points: plan.points.map(([lon, lat]) => ({ lon, lat })),
          profile,
          alternatives: 1,
        },
        signal,
      });
      if (signal.aborted) return;
      const stretch = data?.routes[0];
      if (stretch) {
        this.store.applyLocalEdit(
          plan.window,
          {
            geometry: stretch.geometry as LngLat3[],
            distanceMeters: stretch.distanceMeters,
            ascentMeters: stretch.ascentMeters,
            durationSeconds: stretch.durationSeconds,
            ...(stretch.surfaces === undefined
              ? {}
              : { surfaces: stretch.surfaces }),
          },
          route,
        );
      } else {
        this.store.setLocalEditError(errorCodeFrom(response.status, error));
      }
    } catch {
      if (!signal.aborted) this.store.setLocalEditError('unavailable');
    }
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
