import { Injectable, computed, signal } from '@angular/core';
import type { LngLat } from '../core/map/map-factory';
import type { SavedRoute } from '../storage/saved-route';

export const PROFILES = ['road', 'gravel', 'trail'] as const;
export type Profile = (typeof PROFILES)[number];

/** The API accepts up to 20 points and 4 alternatives; the planner offers 3. */
export const MAX_POINTS = 20;
export const MAX_ALTERNATIVES = 3;

export interface PlannedRoute {
  /** `[longitude, latitude, elevation in meters]` per point. */
  geometry: [number, number, number][];
  distanceMeters: number;
  ascentMeters: number;
  durationSeconds: number;
}

export type PlannerStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Error codes of the API, plus two that only exist on the client. */
export type PlannerErrorCode =
  | 'invalid_request'
  | 'no_route'
  | 'unavailable'
  | 'provider_error'
  | 'rate_limited'
  | 'unknown';

export type PointRole = 'start' | 'waypoint' | 'end';

/** The first point is the start, the last (when there are two or more) the end. */
export function pointRole(index: number, total: number): PointRole {
  if (index === 0) return 'start';
  return index === total - 1 ? 'end' : 'waypoint';
}

/** Identifies the inputs of a computation, to recognise the ones a restored route came from. */
export function inputsSignature(
  points: readonly LngLat[],
  profile: Profile,
  alternatives: number,
): string {
  return JSON.stringify([points, profile, alternatives]);
}

/** The selected route with what it was computed from: what "Save" stores. */
export interface SavableRoute extends PlannedRoute {
  points: LngLat[];
  profile: Profile;
}

/** Ask the map to show a route, e.g. after opening a saved one. `id` makes each request new. */
export interface ViewRequest {
  id: number;
  geometry: [number, number, number][];
}

/**
 * State of the route being planned, and the pure rules that change it. Computing the route
 * (network, debounce) is the job of {@link RoutePlanner}.
 */
@Injectable({ providedIn: 'root' })
export class PlannerStore {
  private readonly pointsState = signal<LngLat[]>([]);
  private readonly profileState = signal<Profile>('road');
  private readonly alternativesState = signal(1);
  private readonly routesState = signal<PlannedRoute[]>([]);
  private readonly selectedState = signal(0);
  private readonly statusState = signal<PlannerStatus>('idle');
  private readonly errorState = signal<PlannerErrorCode | null>(null);

  readonly points = this.pointsState.asReadonly();
  readonly profile = this.profileState.asReadonly();
  readonly alternatives = this.alternativesState.asReadonly();
  readonly routes = this.routesState.asReadonly();
  readonly selectedIndex = this.selectedState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly errorCode = this.errorState.asReadonly();

  private readonly viewState = signal<ViewRequest | null>(null);
  readonly viewRequest = this.viewState.asReadonly();

  /**
   * Signature of the inputs a saved route was restored with. While the inputs still match it,
   * {@link RoutePlanner} must not recompute: the routes are already in the state.
   */
  private restored: string | null = null;

  /** The selected route, when it is computed and can be saved. */
  readonly savable = computed<SavableRoute | null>(() => {
    const route = this.routesState()[this.selectedState()];
    const points = this.pointsState();
    if (this.statusState() !== 'ready' || !route || points.length < 2) {
      return null;
    }
    return { ...route, points, profile: this.profileState() };
  });

  /**
   * The first click sets the start, the second the end, and the following ones add waypoints
   * just before the end. Ignored beyond {@link MAX_POINTS}.
   */
  addPoint(point: LngLat): void {
    this.pointsState.update((points) => {
      if (points.length >= MAX_POINTS) return points;
      if (points.length < 2) return [...points, point];
      return [...points.slice(0, -1), point, points[points.length - 1]];
    });
  }

  movePoint(index: number, point: LngLat): void {
    this.pointsState.update((points) =>
      index >= 0 && index < points.length
        ? points.map((p, i) => (i === index ? point : p))
        : points,
    );
  }

  removePoint(index: number): void {
    this.pointsState.update((points) => points.filter((_, i) => i !== index));
  }

  clear(): void {
    this.pointsState.set([]);
  }

  setProfile(profile: Profile): void {
    this.profileState.set(profile);
  }

  setAlternatives(count: number): void {
    const clamped = Math.min(MAX_ALTERNATIVES, Math.max(1, Math.round(count)));
    this.alternativesState.set(clamped);
  }

  selectRoute(index: number): void {
    if (index >= 0 && index < this.routesState().length) {
      this.selectedState.set(index);
    }
  }

  /**
   * Shows a saved route as it was, without computing anything: points, profile and itinerary
   * come from the record. Only the selected route was saved, so alternatives go back to 1. The
   * first edit made afterwards computes normally.
   */
  loadSaved(saved: SavedRoute): void {
    this.restored = inputsSignature(saved.points, saved.profile, 1);
    this.pointsState.set(saved.points.map((p) => [p[0], p[1]] as LngLat));
    this.profileState.set(saved.profile);
    this.alternativesState.set(1);
    this.routesState.set([
      {
        geometry: saved.geometry,
        distanceMeters: saved.distanceMeters,
        ascentMeters: saved.ascentMeters,
        durationSeconds: saved.durationSeconds,
      },
    ]);
    this.selectedState.set(0);
    this.errorState.set(null);
    this.statusState.set('ready');
    this.viewState.update((view) => ({
      id: (view?.id ?? 0) + 1,
      geometry: saved.geometry,
    }));
  }

  /** True while the inputs are exactly those of the route restored by {@link loadSaved}. */
  isRestored(signature: string): boolean {
    return this.restored === signature;
  }

  /** The inputs changed: the restored route no longer matches, later changes compute. */
  forgetRestored(): void {
    this.restored = null;
  }

  /** A computation started: keep the previous routes on screen until it ends. */
  startLoading(): void {
    this.statusState.set('loading');
    this.errorState.set(null);
  }

  setRoutes(routes: PlannedRoute[]): void {
    this.routesState.set(routes);
    this.selectedState.set(0);
    this.errorState.set(null);
    this.statusState.set('ready');
  }

  setError(code: PlannerErrorCode): void {
    this.routesState.set([]);
    this.selectedState.set(0);
    this.errorState.set(code);
    this.statusState.set('error');
  }

  /** Nothing to compute (fewer than two points). */
  resetResult(): void {
    this.routesState.set([]);
    this.selectedState.set(0);
    this.errorState.set(null);
    this.statusState.set('idle');
  }
}
