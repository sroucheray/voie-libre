import { Injectable, signal } from '@angular/core';
import type { LngLat } from '../core/map/map-factory';

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
