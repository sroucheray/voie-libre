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
  | 'surfaces'
  | 'loop'
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
  /**
   * What the route rides on, one character per segment of the geometry (`geometry.length - 1`):
   * `p` paved, `c` cycleway, `u` unpaved or rough, `s` path, `?` unknown. Absent for a route that
   * does not tell (imported file, saved before this existed).
   */
  surfaces?: string;
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
) & {
  previous: LngLat[];
  next: LngLat[];
  /** The place was chosen on purpose (search, "My position"): the route is computed in full. */
  deliberate?: boolean;
};

/**
 * The state before a change, to come back to. `routes` is what was on screen then, or `null` when
 * it was not up to date with the points (still loading, or in error): going back to it computes.
 */
/** A change of the points that a stretch of the route can absorb. */
type EditOf = (
  | { kind: 'insert'; index: number; point: LngLat }
  | { kind: 'move'; index: number; from: LngLat; point: LngLat }
  | { kind: 'remove'; index: number; point: LngLat }
) & { deliberate?: boolean };

/** `points` with point `index` moved; the start and the end of a loop move together. */
function movedPoints(
  points: LngLat[],
  index: number,
  point: LngLat,
): { next: LngLat[]; edit?: EditOf } | null {
  if (index < 0 || index >= points.length) return null;
  const together =
    isLoopOf(points) && (index === 0 || index === points.length - 1);
  const next = points.map((p, i) =>
    i === index || (together && (i === 0 || i === points.length - 1))
      ? point
      : p,
  );
  // Both ends of a loop move at once: no single stretch to recompute.
  return together
    ? { next }
    : { next, edit: { kind: 'move', index, from: points[index], point } };
}

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
  /** The loop mode the points were computed with, when there was one. */
  loop?: LoopMode;
}

/** Ask the map to show a route, e.g. after opening a saved one. `id` makes each request new. */
export interface ViewRequest {
  id: number;
  geometry: [number, number, number][];
  /** The user asked for it: the map glides there instead of jumping. */
  animate?: boolean;
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
  /** Short names of the same places (see {@link shortOf}), kept the same way. */
  private readonly shortsState = signal<Readonly<Record<string, string>>>({});
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
  /**
   * The route `lastEdit` can be applied to: the one that was on screen for the points it started
   * from. `null` when there was none (still loading, in error, or not the route of those points).
   */
  private lastEditRoute: PlannedRoute | null = null;
  /** The state a drag on the map started from, while it lasts. */
  private dragBase: Snapshot | null = null;
  private readonly draggingState = signal(false);
  /** True while a marker (or the route, to insert a point) is being dragged on the map. */
  readonly dragging = this.draggingState.asReadonly();

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

  /** What the selected route rides on, one character per segment; `null` when it does not say. */
  readonly selectedSurfaces = computed(
    () => this.routesState()[this.selectedState()]?.surfaces ?? null,
  );

  /**
   * True when a route is on screen and does not say what it rides on: saved before that was kept,
   * imported, or opened from a link. It can be calculated again with {@link recompute}.
   */
  readonly surfaceMissing = computed(
    () =>
      this.statusState() === 'ready' &&
      !!this.routesState()[this.selectedState()] &&
      this.selectedSurfaces() === null,
  );

  /**
   * True when the route can be asked for again from its points: not for a route from a place to
   * itself that is no loop mode (a loop by distance is not kept with a saved route, and the engine
   * cannot route from a place to the same place).
   */
  readonly canRecompute = computed(() => {
    const points = this.pointsState();
    if (points.length < 2) return false;
    const [first, last] = [points[0], points[points.length - 1]];
    const samePlace = first[0] === last[0] && first[1] === last[1];
    return !(points.length === 2 && samePlace && !this.loop());
  });

  /** Bumped by {@link recompute}: the planner reads it to compute although the inputs are the same. */
  readonly recomputeCount = signal(0);

  /**
   * Calculates the route again from its points, as a change of the route would: the one on screen
   * may differ (a route edited by hand, an imported track). One step of history, so undo brings the
   * previous route back without a request.
   */
  recompute(): void {
    if (!this.canRecompute()) return;
    this.record();
    this.refreshing = true;
    this.lastEdit = null;
    this.lastEditRoute = null;
    this.restored = null;
    this.routesFor = null;
    this.recomputeCount.update((n) => n + 1);
  }

  /** A computation asked for by {@link recompute} is due: a failure must keep the route on screen. */
  private refreshing = false;

  /** True once after {@link recompute}: the computation that follows is that request. */
  takeRefresh(): boolean {
    const was = this.refreshing;
    this.refreshing = false;
    return was;
  }

  /** The user asks for the whole route on screen: the map glides to it. */
  fitSelectedRoute(): void {
    const geometry = this.selectedGeometry();
    if (geometry.length < 2) return;
    this.viewState.update((view) => ({
      id: (view?.id ?? 0) + 1,
      geometry,
      animate: true,
    }));
  }

  /** The user asks for the stretch picked on the profile on screen: the map glides to it. */
  fitStretch(): void {
    const stretch = this.stretch();
    if (!stretch) return;
    const geometry = this.selectedGeometry().slice(
      stretch.from,
      stretch.to + 1,
    );
    if (geometry.length < 2) return;
    this.viewState.update((view) => ({
      id: (view?.id ?? 0) + 1,
      geometry,
      animate: true,
    }));
  }

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
    const loop = this.loop();
    return {
      ...route,
      points,
      profile: this.profileState(),
      ...(loop ? { loop } : {}),
    };
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
  insertPoint(index: number, point: LngLat, deliberate = false): void {
    const points = this.pointsState();
    if (points.length < 2 || points.length >= MAX_POINTS) return;
    const at = Math.min(Math.max(index, 1), points.length - 1);
    this.setPoints([...points.slice(0, at), point, ...points.slice(at)], {
      kind: 'insert',
      index: at,
      point,
      ...(deliberate ? { deliberate } : {}),
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
  movePoint(index: number, point: LngLat, deliberate = false): void {
    const moved = movedPoints(this.pointsState(), index, point);
    if (!moved) return;
    this.setPoints(
      moved.next,
      moved.edit && deliberate
        ? { ...moved.edit, deliberate: true }
        : moved.edit,
    );
  }

  /**
   * A drag starts on the map. Until {@link endDrag} or {@link cancelDrag}, {@link dragTo} shows
   * where the point would go, each time from the state the drag started from: the whole drag is
   * one change, undone in one step.
   */
  startDrag(): void {
    if (this.dragBase) return;
    this.dragBase = this.snapshot();
    this.draggingState.set(true);
  }

  /** The point being dragged is here now: moves point `index`, or inserts a waypoint at `index`. */
  dragTo(change: {
    kind: 'move' | 'insert';
    index: number;
    point: LngLat;
  }): void {
    const base = this.dragBase;
    if (!base) return;
    const { index, point } = change;
    let next: LngLat[];
    let edit: EditOf | undefined;
    if (change.kind === 'move') {
      const moved = movedPoints(base.points, index, point);
      if (!moved) return;
      ({ next, edit } = moved);
    } else {
      const points = base.points;
      if (points.length < 2 || points.length >= MAX_POINTS) return;
      const at = Math.min(Math.max(index, 1), points.length - 1);
      next = [...points.slice(0, at), point, ...points.slice(at)];
      edit = { kind: 'insert', index: at, point };
    }
    const current = this.pointsState();
    if (
      next.length === current.length &&
      next.every((p, i) => p[0] === current[i][0] && p[1] === current[i][1])
    ) {
      return;
    }
    this.lastEditRoute = base.routes?.[base.selected] ?? null;
    this.lastEdit = edit ? { ...edit, previous: base.points, next } : null;
    this.pointsState.set(next);
  }

  /** The drag ends where it is: one step of history, back to where it started. */
  endDrag(): void {
    const base = this.dragBase;
    this.dragBase = null;
    this.draggingState.set(false);
    if (!base || base.points === this.pointsState()) return;
    this.undoStack.update((stack) => [...stack, base].slice(-HISTORY_DEPTH));
    this.redoStack.set([]);
  }

  /** The drag is given up: the points and the route are those it started from. */
  cancelDrag(): void {
    const base = this.dragBase;
    this.dragBase = null;
    this.draggingState.set(false);
    if (base && base.points !== this.pointsState()) this.restore(base);
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
  setLabel(point: LngLat, label: string, short?: string): void {
    const key = labelKey(point);
    const { [key]: _old, ...rest } = this.labelsState();
    const entries = Object.entries({ ...rest, [key]: label });
    this.labelsState.set(Object.fromEntries(entries.slice(-MAX_LABELS)));
    const { [key]: _oldShort, ...restShorts } = this.shortsState();
    const shorts = Object.entries(
      short ? { ...restShorts, [key]: short } : restShorts,
    );
    this.shortsState.set(Object.fromEntries(shorts.slice(-MAX_LABELS)));
  }

  /**
   * A short name to call the place at `point` by, if one is known: its own name when it was
   * searched, its town or village when it was found for a click. It never recomputes a route.
   */
  shortOf(point: LngLat): string | null {
    return this.shortsState()[labelKey(point)] ?? null;
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
   * True when the route can be reversed: two points or more, and a different order once reversed
   * (a loop needs two stops at least: with one or none, it reads the same both ways).
   */
  readonly canReverse = computed(() => {
    const points = this.pointsState();
    return points.length >= (isLoopOf(points) ? 4 : 2);
  });

  /**
   * Reverses the route: the end becomes the start and the stops are visited in the opposite order.
   * A loop keeps its start and goes round the other way. The way back is not the way out (one-way
   * streets, climbs), so the whole route is computed again.
   */
  reverse(): void {
    if (!this.canReverse()) return;
    this.removedState.set(null);
    this.setPoints([...this.pointsState()].reverse());
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

  /** Selects a route and asks the map to show all of it (a click on its card in the panel). */
  showRoute(index: number): void {
    const route = this.routesState()[index];
    if (!route) return;
    this.selectRoute(index);
    this.viewState.update((view) => ({
      id: (view?.id ?? 0) + 1,
      geometry: route.geometry,
    }));
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
    this.pointsState.set(saved.points.map((p) => [p[0], p[1]] as LngLat));
    // The loop mode kept with the route (routes saved before it was kept have none).
    this.loopState.set(saved.loop ?? null);
    this.noLookup.clear();
    for (const p of [saved.points[0], saved.points[saved.points.length - 1]]) {
      if (p) this.noLookup.add(labelKey([p[0], p[1]]));
    }
    this.profileState.set(saved.profile);
    this.alternativesState.set(1);
    this.restored = this.routesFor = this.currentSignature();
    this.routesState.set([
      {
        geometry: saved.geometry,
        distanceMeters: saved.distanceMeters,
        ascentMeters: saved.ascentMeters,
        durationSeconds: saved.durationSeconds,
        elevationSource: saved.elevationSource,
        ...(saved.surfaces === undefined ? {} : { surfaces: saved.surfaces }),
      },
    ]);
    this.selectedState.set(0);
    this.cursor.set(null);
    this.errorState.set(null);
    this.statusState.set('ready');
    this.markSaved();
    this.viewState.update((view) => ({
      id: (view?.id ?? 0) + 1,
      geometry: saved.geometry,
    }));
  }

  /** Sets the points, remembering the change when it is one a stretch of the route can absorb. */
  private setPoints(next: LngLat[], edit?: EditOf): void {
    this.record();
    // A second edit made before the route of the first is in place starts from a route that is not
    // the one of its points: it cannot be applied to it.
    this.lastEditRoute =
      this.statusState() === 'ready' &&
      this.routesFor === this.currentSignature()
        ? (this.routesState()[this.selectedState()] ?? null)
        : null;
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
    return this.signature();
  }

  /** What the route on screen was computed from (points, profile, alternatives, loop mode). */
  private readonly signature = computed(() =>
    inputsSignature(
      this.pointsState(),
      this.profileState(),
      this.alternativesState(),
      this.loop(),
    ),
  );

  /** The inputs of the route when it was last saved or opened from a saved route; `null` before. */
  private readonly savedSignature = signal<string | null>(null);

  /**
   * True when there is work on screen that is not on the device: points that are not those of the
   * route last saved or opened. Editing a route and undoing the edit makes it false again; an
   * opened route nobody touched, or one just saved, is not unsaved work.
   */
  readonly unsaved = computed(
    () =>
      this.pointsState().length > 0 &&
      this.savedSignature() !== this.signature(),
  );

  /** The saved route the inputs on screen belong to (just saved or opened), for the confirmation. */
  private readonly savedRef = signal<{ id: string; name: string } | null>(null);

  /**
   * The saved route that is exactly what is on screen: set when it was just saved or opened,
   * `null` as soon as the route is edited. The panel then says "Saved" instead of offering to save.
   */
  readonly savedAs = computed(() =>
    this.pointsState().length > 0 && this.savedSignature() === this.signature()
      ? this.savedRef()
      : null,
  );

  /** The saved route to show lit in the list for a moment (after "Show in Saved"). */
  readonly highlightedId = signal<string | null>(null);
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** The route on screen was just saved: it is no longer unsaved work. */
  markSaved(ref?: { id: string; name: string }): void {
    this.savedSignature.set(this.signature());
    this.savedRef.set(ref ?? null);
  }

  /** A saved route was renamed or deleted: the confirmation follows. */
  renameSaved(id: string, name: string): void {
    this.savedRef.update((ref) => (ref?.id === id ? { id, name } : ref));
  }

  forgetSaved(id: string): void {
    if (this.savedRef()?.id === id) this.savedRef.set(null);
  }

  highlightSaved(id: string): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightedId.set(id);
    this.highlightTimer = setTimeout(() => this.highlightedId.set(null), 3000);
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
    return this.lastEdit?.next === points && this.lastEditRoute
      ? this.lastEdit
      : null;
  }

  /** The route the edit of {@link editBehind} applies to (the one a drag started from, if any). */
  routeBehind(points: readonly LngLat[]): PlannedRoute | null {
    return this.lastEdit?.next === points ? this.lastEditRoute : null;
  }

  /**
   * Replaces `window` of `route` (the selected one unless the edit started from another, see
   * {@link routeBehind}) with `stretch`, the answer for that stretch alone. Only that alternative
   * is kept, so alternatives go back to 1, and the result counts as restored: {@link RoutePlanner}
   * must not compute it again.
   */
  applyLocalEdit(
    window: EditWindow,
    stretch: Stretch,
    route: PlannedRoute | undefined = this.routesState()[this.selectedState()],
  ): void {
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
