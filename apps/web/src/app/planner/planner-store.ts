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
/** How many changes can be undone. */
export const HISTORY_DEPTH = 20;

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

/** How many place names are remembered; the oldest are forgotten first. */
const MAX_LABELS = 100;

const labelKey = (point: LngLat): string => `${point[0]},${point[1]}`;

/** The first point is the start, the last (when there are two or more) the end. */
export function pointRole(index: number, total: number): PointRole {
  if (index === 0) return 'start';
  return index === total - 1 ? 'end' : 'waypoint';
}

/**
 * How a loop is closed, beyond "back to the start" (no mode). Sent to the API with the points:
 * - `avoid_outbound`: the points go out and end on the start; the way back avoids the way out.
 * - `distance`: the points are the start twice; the loop has about this length and, if asked,
 *   about this climb (approached by trying several directions). With a `direction` it heads
 *   that way from the start; without, the alternatives spread around the compass.
 */
export type LoopMode =
  | { mode: 'avoid_outbound' }
  | {
      mode: 'distance';
      distanceMeters: number;
      ascentMeters?: number;
      direction?: LoopDirection;
    };

/** The compass points a loop by distance can head to, clockwise from north. */
export const LOOP_DIRECTIONS = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
] as const;
export type LoopDirection = (typeof LOOP_DIRECTIONS)[number];

export const LOOP_DISTANCE_MIN_METERS = 2_000;
export const LOOP_DISTANCE_MAX_METERS = 200_000;
export const LOOP_DISTANCE_DEFAULT_METERS = 30_000;
export const LOOP_ASCENT_MAX_METERS = 10_000;

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

/**
 * The state before a change, to come back to. `routes` is what was on screen then, or `null` when
 * it was not up to date with the points (still loading, or in error): going back to it computes.
 */
interface Snapshot {
  points: LngLat[];
  profile: Profile;
  alternatives: number;
  loop: LoopMode | null;
  routes: PlannedRoute[] | null;
  selected: number;
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

  private readonly removedState = signal<{
    index: number;
    point: LngLat;
  } | null>(null);
  /** The point removed last, until it is undone or forgotten. */
  readonly removed = this.removedState.asReadonly();

  readonly points = this.pointsState.asReadonly();

  /**
   * Names of places (an address found by search, or by reverse geocoding), by position. Keyed by
   * coordinates so that a name follows its point through reordering, undo and redo without any
   * change to those operations; a point with no name is shown by its coordinates. A name is never
   * part of the route inputs: setting one never recomputes anything.
   */
  private readonly labelsState = signal<Readonly<Record<string, string>>>({});
  readonly labels = this.labelsState.asReadonly();
  /** Positions of a route that was opened, not planned: nothing is asked about them. */
  private readonly noLookup = new Set<string>();
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
  /** The stretch picked on the profile, with the geometry it was picked on. */
  private readonly stretchState = signal<{
    geometry: [number, number, number][];
    from: number;
    to: number;
  } | null>(null);
  /**
   * Stretch of the selected route picked on the profile (indexes in its geometry, `from` before
   * `to`), shown on the map. It ends by itself as soon as the route on screen is another one.
   */
  readonly stretch = computed<{ from: number; to: number } | null>(() => {
    const stretch = this.stretchState();
    return stretch && stretch.geometry === this.selectedGeometry()
      ? { from: stretch.from, to: stretch.to }
      : null;
  });
  /** A saved route shown for a moment on the map (hovered in the list); never part of the plan. */
  readonly preview = signal<[number, number, number][] | null>(null);

  /** True when the end is on the start. */
  readonly isLoop = computed(() => isLoopOf(this.pointsState()));

  private readonly loopState = signal<LoopMode | null>(null);

  /** The last change to the points that is a {@link PointEdit}, if it still is the latest. */
  private lastEdit: PointEdit | null = null;
  /** True when the route on screen was that of the points `lastEdit` started from. */
  private lastEditFromRoute = false;

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

  /** Picks the stretch between two points of the selected route, in either order; `null` clears it. */
  selectStretch(range: [number, number] | null): void {
    const geometry = this.selectedGeometry();
    if (!range || geometry.length < 2) {
      this.stretchState.set(null);
      return;
    }
    const clamp = (index: number) =>
      Math.max(0, Math.min(geometry.length - 1, index));
    const from = clamp(Math.min(range[0], range[1]));
    const to = clamp(Math.max(range[0], range[1]));
    this.stretchState.set(from === to ? null : { geometry, from, to });
  }

  private readonly viewState = signal<ViewRequest | null>(null);
  readonly viewRequest = this.viewState.asReadonly();

  /**
   * Signature of the inputs a saved route was restored with. While the inputs still match it,
   * {@link RoutePlanner} must not recompute: the routes are already in the state.
   */
  private restored: string | null = null;

  /** Signature of the inputs the routes on screen were computed from, or null (none, or unknown). */
  private routesFor: string | null = null;

  private readonly undoStack = signal<Snapshot[]>([]);
  private readonly redoStack = signal<Snapshot[]>([]);
  /** True when a change can be undone, and when an undone change can be redone. */
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

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
      this.record();
      this.pointsState.set([points[0], points[0]]);
      this.loopState.set(mode);
      return;
    }
    if (points.length < 2) return;
    if (!isLoopOf(points) && points.length >= MAX_POINTS) return;
    this.record();
    if (!isLoopOf(points)) this.pointsState.set([...points, points[0]]);
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
    const current = this.loopState();
    if (current?.mode === 'distance' && current.distanceMeters === clamped) {
      return;
    }
    if (current?.mode !== 'distance') return;
    this.record();
    this.loopState.set({ ...current, distanceMeters: clamped });
  }

  /** Sets the climb a loop by distance should come close to; `null` (or NaN) asks for none. */
  setLoopAscent(ascentMeters: number | null): void {
    const current = this.loopState();
    if (current?.mode !== 'distance') return;
    const next =
      ascentMeters === null || !Number.isFinite(ascentMeters)
        ? undefined
        : Math.min(
            LOOP_ASCENT_MAX_METERS,
            Math.max(0, Math.round(ascentMeters)),
          );
    if (next === current.ascentMeters) return;
    this.record();
    const { ascentMeters: _dropped, ...rest } = current;
    this.loopState.set({
      ...rest,
      ...(next === undefined ? {} : { ascentMeters: next }),
    });
  }

  /** Sets the way a loop by distance heads from the start; `null` leaves it to the engine. */
  setLoopDirection(direction: LoopDirection | null): void {
    const current = this.loopState();
    if (current?.mode !== 'distance') return;
    if ((direction ?? undefined) === current.direction) return;
    this.record();
    const { direction: _dropped, ...rest } = current;
    this.loopState.set({ ...rest, ...(direction ? { direction } : {}) });
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
    if (this.pointsState().length === 0) this.setPoints([point]);
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

  /** Names the place at `point`, e.g. with the address the user picked or one found for a click. */
  setLabel(point: LngLat, label: string): void {
    const key = labelKey(point);
    const { [key]: _old, ...rest } = this.labelsState();
    const entries = Object.entries({ ...rest, [key]: label });
    this.labelsState.set(Object.fromEntries(entries.slice(-MAX_LABELS)));
  }

  /**
   * False for the ends of a route that was opened (saved, imported or shared): opening one never
   * calls the API, so its ends keep their coordinates until the user changes them.
   */
  lookupWanted(point: LngLat): boolean {
    return !this.noLookup.has(labelKey(point));
  }

  /** The name of the place at `point`, if one is known. */
  labelOf(point: LngLat): string | null {
    return this.labelsState()[labelKey(point)] ?? null;
  }

  /**
   * Swaps the start and the end, as the swap button of a route search does; the stops in between
   * stay where they are. No-op for a loop or fewer than two points. Several segments change, so
   * the whole route is computed again.
   */
  swapEnds(): void {
    const points = this.pointsState();
    if (points.length < 2 || isLoopOf(points)) return;
    const next = [...points];
    next[0] = points[points.length - 1];
    next[points.length - 1] = points[0];
    this.removedState.set(null);
    this.setPoints(next);
  }

  /** Moves the point at `from` to the place `to` (after the move, it is at index `to`). */
  reorderPoint(from: number, to: number): void {
    const points = this.pointsState();
    if (from === to || !points[from] || to < 0 || to >= points.length) return;
    const next = [...points];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.removedState.set(null);
    // Several segments change: no local edit, the whole route is computed again.
    this.setPoints(next);
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
    if (this.pointsState().length > 0 || this.loopState()) this.record();
    this.removedState.set(null);
    this.loopState.set(null);
    this.pointsState.set([]);
  }

  setProfile(profile: Profile): void {
    if (profile === this.profileState()) return;
    this.record();
    this.profileState.set(profile);
  }

  setAlternatives(count: number): void {
    const clamped = Math.min(MAX_ALTERNATIVES, Math.max(1, Math.round(count)));
    if (clamped === this.alternativesState()) return;
    this.record();
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
    this.preview.set(null);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.loopState.set(null);
    this.restored = this.routesFor = inputsSignature(
      saved.points,
      saved.profile,
      1,
    );
    this.pointsState.set(saved.points.map((p) => [p[0], p[1]] as LngLat));
    this.noLookup.clear();
    for (const p of [saved.points[0], saved.points[saved.points.length - 1]]) {
      if (p) this.noLookup.add(labelKey([p[0], p[1]]));
    }
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
    this.record();
    // A second edit made before the route of the first is in place starts from a route that is not
    // the one of its points: it cannot be applied to it.
    this.lastEditFromRoute =
      this.statusState() === 'ready' &&
      this.routesFor === this.currentSignature();
    this.lastEdit = edit
      ? { ...edit, previous: this.pointsState(), next }
      : null;
    this.pointsState.set(next);
  }

  /** The current state, with the routes only if they are those of the current inputs. */
  private snapshot(): Snapshot {
    const upToDate =
      this.statusState() === 'ready' &&
      this.routesFor === this.currentSignature();
    return {
      points: this.pointsState(),
      profile: this.profileState(),
      alternatives: this.alternativesState(),
      loop: this.loopState(),
      routes: upToDate ? this.routesState() : null,
      selected: this.selectedState(),
    };
  }

  private currentSignature(): string {
    return inputsSignature(
      this.pointsState(),
      this.profileState(),
      this.alternativesState(),
      this.loop(),
    );
  }

  /** Remembers the state before a change, which also ends what could be redone. */
  private record(): void {
    this.undoStack.update((stack) =>
      [...stack, this.snapshot()].slice(-HISTORY_DEPTH),
    );
    this.redoStack.set([]);
  }

  /** Goes back to the state before the last change. The route of that state is not computed again. */
  undo(): void {
    const stack = this.undoStack();
    const target = stack[stack.length - 1];
    if (!target) return;
    const current = this.snapshot();
    this.undoStack.set(stack.slice(0, -1));
    this.redoStack.update((redo) => [...redo, current]);
    this.restore(target);
  }

  /** Does again the change that was undone last, until a new change is made. */
  redo(): void {
    const stack = this.redoStack();
    const target = stack[stack.length - 1];
    if (!target) return;
    const current = this.snapshot();
    this.redoStack.set(stack.slice(0, -1));
    this.undoStack.update((undo) => [...undo, current].slice(-HISTORY_DEPTH));
    this.restore(target);
  }

  private restore(snapshot: Snapshot): void {
    this.lastEdit = null;
    this.removedState.set(null);
    this.loopState.set(snapshot.loop);
    this.pointsState.set(snapshot.points);
    this.profileState.set(snapshot.profile);
    this.alternativesState.set(snapshot.alternatives);
    this.cursor.set(null);
    this.errorState.set(null);
    if (snapshot.routes) {
      // The route was computed from exactly these inputs: no new computation.
      this.routesState.set(snapshot.routes);
      this.selectedState.set(snapshot.selected);
      this.statusState.set('ready');
      this.routesFor = this.restored = this.currentSignature();
    } else {
      // Nothing valid to show: the points compute as for any change (or reset with fewer than two).
      this.routesState.set([]);
      this.selectedState.set(0);
      this.statusState.set('idle');
      this.routesFor = this.restored = null;
    }
  }

  /**
   * The change that produced `points`, when it was a single edit of the previous list (and nothing
   * has changed the points since). `null` otherwise: the route must be computed in full.
   */
  editBehind(points: readonly LngLat[]): PointEdit | null {
    return this.lastEdit?.next === points && this.lastEditFromRoute
      ? this.lastEdit
      : null;
  }

  /**
   * Replaces `window` of the selected route with `stretch`, the answer for that stretch alone. Only
   * the selected alternative is kept, so alternatives go back to 1, and the result counts as
   * restored: {@link RoutePlanner} must not compute it again.
   */
  applyLocalEdit(window: EditWindow, stretch: Stretch): void {
    const route = this.routesState()[this.selectedState()];
    if (!route) return;
    this.restored = this.routesFor = inputsSignature(
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
    this.routesFor = this.currentSignature();
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

  /**
   * A local edit could not be computed: the route stays on screen as it was, with the error. It is
   * no longer the route of the points, so the next change computes in full.
   */
  setLocalEditError(code: PlannerErrorCode): void {
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
