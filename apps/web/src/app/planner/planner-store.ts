import { Injectable, computed, signal } from '@angular/core';
import type { LngLat } from '../core/map/map-factory';
import type { SavedRoute } from '../storage/saved-route';
import { applyStretch, type EditWindow, type Stretch } from './local-edit';

/** What it takes to show a route as it was: a saved route, or one opened from a shared link. */
export type RestorableRoute = Pick<
  SavedRoute,
  | 'points'
  | 'profile'
  | 'geometry'
  | 'distanceMeters'
  | 'ascentMeters'
  | 'durationSeconds'
  | 'elevationSource'
>;

export const PROFILES = ['road', 'gravel', 'trail'] as const;
export type Profile = (typeof PROFILES)[number];

/** The API accepts up to 20 points and 4 alternatives; the planner offers 3. */
export const MAX_POINTS = 20;
export const MAX_ALTERNATIVES = 3;

export interface PlannedRoute {
  /** `[longitude, latitude, elevation in meters]` per point. */
  geometry: [number, number, number][];
  distanceMeters: number;
  /** `null` when unknown: an imported file without elevation. */
  ascentMeters: number | null;
  durationSeconds: number;
  /** Where the elevations come from when it must be credited (see `ELEVATION_SOURCES`). */
  elevationSource?: ElevationSource;
}

/** Elevation data that carries an attribution requirement. */
export type ElevationSource = 'copernicus' | 'srtm';

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
 * How a loop is closed, beyond "back to the start" (no mode). Sent to the API with the points:
 * - `avoid_outbound`: the points go out and end on the start; the way back avoids the way out.
 * - `distance`: the points are the start twice; the loop has about this length.
 */
export type LoopMode =
  { mode: 'avoid_outbound' } | { mode: 'distance'; distanceMeters: number };

export const LOOP_DISTANCE_MIN_METERS = 2_000;
export const LOOP_DISTANCE_MAX_METERS = 200_000;
export const LOOP_DISTANCE_DEFAULT_METERS = 30_000;

/** A route of two points or more whose end is exactly on its start. */
export function isLoopOf(points: readonly LngLat[]): boolean {
  if (points.length < 2) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/** Identifies the inputs of a computation, to recognise the ones a restored route came from. */
export function inputsSignature(
  points: readonly LngLat[],
  profile: Profile,
  alternatives: number,
  loop: LoopMode | null = null,
): string {
  return JSON.stringify([points, profile, alternatives, loop]);
}

/**
 * A change to the list of points that can be applied to a computed route by recomputing only a
 * stretch of it. `previous` and `next` are the lists before and after: an edit applies only
 * while `next` is still the current list.
 */
export type PointEdit = (
  | { kind: 'insert'; index: number; point: LngLat }
  | { kind: 'move'; index: number; from: LngLat; point: LngLat }
  | { kind: 'remove'; index: number; point: LngLat }
) & { previous: LngLat[]; next: LngLat[] };

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

  private readonly removedState = signal<{
    index: number;
    point: LngLat;
  } | null>(null);
  /** The point removed last, until it is undone or forgotten. */
  readonly removed = this.removedState.asReadonly();

  readonly points = this.pointsState.asReadonly();
  readonly profile = this.profileState.asReadonly();
  readonly alternatives = this.alternativesState.asReadonly();
  readonly routes = this.routesState.asReadonly();
  readonly selectedIndex = this.selectedState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly errorCode = this.errorState.asReadonly();

  /**
   * Index in the selected route's geometry of the point being inspected, from the profile or from
   * hovering the route on the map. Followed by the dot on the map and the cursor on the profile.
   */
  readonly cursor = signal<number | null>(null);

  /** True when the end is on the start. */
  readonly isLoop = computed(() => isLoopOf(this.pointsState()));

  private readonly loopState = signal<LoopMode | null>(null);

  /** The last change to the points that is a {@link PointEdit}, if it still is the latest. */
  private lastEdit: PointEdit | null = null;

  /**
   * The loop mode that applies to the current points, or null (plain route, or plain loop back to
   * the start). A mode stops applying when edits no longer fit it, e.g. a stop added to a loop
   * by distance, which then goes through that stop like any route.
   */
  readonly loop = computed<LoopMode | null>(() => {
    const mode = this.loopState();
    const points = this.pointsState();
    if (!mode || !isLoopOf(points)) return null;
    if (mode.mode === 'avoid_outbound') return points.length >= 3 ? mode : null;
    return points.length === 2 ? mode : null;
  });

  /** What the next click on the map will create. */
  readonly nextRole = computed<PointRole>(() => {
    const count = this.pointsState().length;
    return count === 0 ? 'start' : count === 1 ? 'end' : 'waypoint';
  });

  /** False for an imported route without elevation: its geometry carries zeros, not altitudes. */
  readonly elevationKnown = computed(
    () => this.routesState()[this.selectedState()]?.ascentMeters !== null,
  );

  /** The source to credit under the profile, if the elevations need one. */
  readonly elevationSource = computed(
    () => this.routesState()[this.selectedState()]?.elevationSource ?? null,
  );

  /** Geometry of the selected route, which the profile is drawn from. */
  readonly selectedGeometry = computed(
    () => this.routesState()[this.selectedState()]?.geometry ?? [],
  );

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
    const points = this.pointsState();
    if (points.length >= MAX_POINTS) return;
    if (points.length < 2) {
      this.setPoints([...points, point]);
      return;
    }
    this.setPoints([...points.slice(0, -1), point, points[points.length - 1]], {
      kind: 'insert',
      index: points.length - 1,
      point,
    });
  }

  /**
   * Inserts a waypoint so that it ends up at `index` (1 to length - 1: never before the start or
   * after the end). Ignored beyond {@link MAX_POINTS}.
   */
  insertPoint(index: number, point: LngLat): void {
    const points = this.pointsState();
    if (points.length < 2 || points.length >= MAX_POINTS) return;
    const at = Math.min(Math.max(index, 1), points.length - 1);
    this.setPoints([...points.slice(0, at), point, ...points.slice(at)], {
      kind: 'insert',
      index: at,
      point,
    });
  }

  /**
   * Makes the route a loop. Without a mode the end is put on the start. `avoid_outbound` does the
   * same and asks for another way back. `distance` keeps only the start: the loop is drawn by
   * the engine around it. No-op if the route has no two points yet.
   */
  closeLoop(mode?: LoopMode): void {
    const points = this.pointsState();
    if (points.length < 1) return;
    if (mode?.mode === 'distance') {
      this.pointsState.set([points[0], points[0]]);
      this.loopState.set(mode);
      return;
    }
    if (points.length < 2) return;
    if (!isLoopOf(points)) {
      if (points.length >= MAX_POINTS) return;
      this.pointsState.set([...points, points[0]]);
    }
    this.loopState.set(mode ?? null);
  }

  /** Changes the length of a loop by distance, within the limits the API accepts. */
  setLoopDistance(distanceMeters: number): void {
    if (
      this.loopState()?.mode !== 'distance' ||
      !Number.isFinite(distanceMeters)
    ) {
      return;
    }
    const clamped = Math.min(
      LOOP_DISTANCE_MAX_METERS,
      Math.max(LOOP_DISTANCE_MIN_METERS, Math.round(distanceMeters)),
    );
    this.loopState.set({ mode: 'distance', distanceMeters: clamped });
  }

  /** The start and the end of a loop move together, so that it stays closed. */
  movePoint(index: number, point: LngLat): void {
    const points = this.pointsState();
    if (index < 0 || index >= points.length) return;
    const together =
      isLoopOf(points) && (index === 0 || index === points.length - 1);
    const next = points.map((p, i) =>
      i === index || (together && (i === 0 || i === points.length - 1))
        ? point
        : p,
    );
    // Both ends of a loop move at once: no single stretch to recompute.
    this.setPoints(
      next,
      together
        ? undefined
        : { kind: 'move', index, from: points[index], point },
    );
  }

  /** Sets the start (the first point): the first one if there is none yet. */
  setStart(point: LngLat): void {
    if (this.pointsState().length === 0) this.pointsState.set([point]);
    else this.movePoint(0, point);
  }

  /**
   * Sets the end (the last point): it becomes the second point if there is only a start. In a
   * loop only the end moves, which opens the loop.
   */
  setEnd(point: LngLat): void {
    const points = this.pointsState();
    if (points.length === 0) return;
    if (points.length === 1) {
      this.setPoints([...points, point]);
      return;
    }
    const index = points.length - 1;
    this.setPoints([...points.slice(0, -1), point], {
      kind: 'move',
      index,
      from: points[index],
      point,
    });
  }

  removePoint(index: number): void {
    const point = this.pointsState()[index];
    if (!point) return;
    this.removedState.set({ index, point });
    this.setPoints(
      this.pointsState().filter((_, i) => i !== index),
      { kind: 'remove', index, point },
    );
  }

  /** Puts back the point removed last, at its place (or the end if the list got shorter). */
  undoRemove(): void {
    const removed = this.removedState();
    if (!removed) return;
    this.removedState.set(null);
    const points = this.pointsState();
    if (points.length >= MAX_POINTS) return;
    const at = Math.min(removed.index, points.length);
    this.setPoints(
      [...points.slice(0, at), removed.point, ...points.slice(at)],
      { kind: 'insert', index: at, point: removed.point },
    );
  }

  /** Forgets the removed point: the time to undo has passed. */
  forgetRemoved(): void {
    this.removedState.set(null);
  }

  clear(): void {
    this.removedState.set(null);
    this.loopState.set(null);
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
      this.cursor.set(null);
    }
  }

  /**
   * Shows a saved route as it was, without computing anything: points, profile and itinerary
   * come from the record. Only the selected route was saved, so alternatives go back to 1. The
   * first edit made afterwards computes normally.
   */
  loadSaved(saved: RestorableRoute): void {
    this.loopState.set(null);
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
        elevationSource: saved.elevationSource,
      },
    ]);
    this.selectedState.set(0);
    this.cursor.set(null);
    this.errorState.set(null);
    this.statusState.set('ready');
    this.viewState.update((view) => ({
      id: (view?.id ?? 0) + 1,
      geometry: saved.geometry,
    }));
  }

  /** Sets the points, remembering the change when it is one a stretch of the route can absorb. */
  private setPoints(
    next: LngLat[],
    edit?:
      | { kind: 'insert'; index: number; point: LngLat }
      | { kind: 'move'; index: number; from: LngLat; point: LngLat }
      | { kind: 'remove'; index: number; point: LngLat },
  ): void {
    this.lastEdit = edit
      ? { ...edit, previous: this.pointsState(), next }
      : null;
    this.pointsState.set(next);
  }

  /**
   * The change that produced `points`, when it was a single edit of the previous list (and nothing
   * has changed the points since). `null` otherwise: the route must be computed in full.
   */
  editBehind(points: readonly LngLat[]): PointEdit | null {
    return this.lastEdit?.next === points ? this.lastEdit : null;
  }

  /**
   * Replaces `window` of the selected route with `stretch`, the answer for that stretch alone. Only
   * the selected alternative is kept, so alternatives go back to 1, and the result counts as
   * restored: {@link RoutePlanner} must not compute it again.
   */
  applyLocalEdit(window: EditWindow, stretch: Stretch): void {
    const route = this.routesState()[this.selectedState()];
    if (!route) return;
    this.restored = inputsSignature(
      this.pointsState(),
      this.profileState(),
      1,
      this.loop(),
    );
    this.alternativesState.set(1);
    this.routesState.set([applyStretch(route, window, stretch)]);
    this.selectedState.set(0);
    this.cursor.set(null);
    this.errorState.set(null);
    this.statusState.set('ready');
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
    this.cursor.set(null);
    this.errorState.set(null);
    this.statusState.set('ready');
  }

  setError(code: PlannerErrorCode): void {
    this.routesState.set([]);
    this.selectedState.set(0);
    this.cursor.set(null);
    this.errorState.set(code);
    this.statusState.set('error');
  }

  /** Nothing to compute (fewer than two points). */
  resetResult(): void {
    this.routesState.set([]);
    this.selectedState.set(0);
    this.cursor.set(null);
    this.errorState.set(null);
    this.statusState.set('idle');
  }
}
