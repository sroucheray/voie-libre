import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { map, switchMap } from 'rxjs';
import { FormattingService } from '../core/format/formatting.service';
import type { LngLat, MapLike } from '../core/map/map-factory';
import { MapView } from '../core/map/map-view';
import { LocationStore } from '../location/location-store';
import {
  PLANNER_MAP_DRIVER,
  type PlannerMapDriver,
} from './planner-map-driver';
import {
  MAX_ALTERNATIVES,
  LOOP_ASCENT_MAX_METERS,
  LOOP_DISTANCE_DEFAULT_METERS,
  LOOP_DISTANCE_MAX_METERS,
  LOOP_DISTANCE_MIN_METERS,
  LOOP_DIRECTIONS,
  type LoopDirection,
  type LoopMode,
  MAX_POINTS,
  PROFILES,
  PlannerStore,
  type Profile,
  isLoopOf,
  pointRole,
} from './planner-store';
import { ProfileSelect } from './profile-select';
import { buildProfile, sampleNearest } from './elevation-profile';
import { insertionIndex } from './insert-point';
import { RoutePlanner } from './route-planner';
import { ElevationPanel } from './elevation-panel';
import { SavedRoutes } from '../saved-routes/saved-routes';
import type { FoundPlace } from '../search/geocoding.service';
import { PlaceField } from '../search/place-field';
import { PointNamer } from '../search/point-namer';

/**
 * The map with its planning panel. Clicks place the start, the end and waypoints; markers can be
 * dragged; the route and its alternatives are computed through the API and drawn on the map.
 */
/** How long a removed point can be put back. */
const UNDO_MS = 6000;

/** Where "My position" was asked: the start, the end, the stop at an index, or the new stop. */
type PositionTarget = 'start' | 'end' | 'new' | number;

/** Least time between two routes asked for during a drag: under the API's limit for `POST /route`. */
export const LIVE_DRAG_INTERVAL_MS = 600;

/** Where a drag in progress puts its point. */
type DragChange = { kind: 'move' | 'insert'; index: number; point: LngLat };

@Component({
  selector: 'vl-planner',
  imports: [
    MapView,
    NgTemplateOutlet,
    TranslocoPipe,
    SavedRoutes,
    ElevationPanel,
    PlaceField,
    ProfileSelect,
  ],
  templateUrl: './planner.html',
  styleUrl: './planner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Planner {
  protected readonly store = inject(PlannerStore);
  protected readonly format = inject(FormattingService);
  protected readonly location = inject(LocationStore);
  protected readonly profiles = PROFILES;
  protected readonly alternativeChoices = Array.from(
    { length: MAX_ALTERNATIVES },
    (_, i) => i + 1,
  );

  /** What the help bar says: it depends on how far the route is. */
  protected readonly helpKey = computed(() => {
    const count = this.store.points().length;
    if (this.store.dragging()) return 'planner.hint.dragging';
    if (count === 0) return 'planner.hint.start';
    if (count === 1) return 'planner.hint.end';
    return this.store.isLoop() ? 'planner.hint.loop' : 'planner.hint.route';
  });

  /** What to tell about the user's position: searching, or why it failed. */
  protected readonly locationMessageKey = computed(() => {
    if (this.location.status() === 'searching') return 'location.searching';
    const code = this.location.errorCode();
    return code ? `location.errors.${code}` : null;
  });

  /** Why the button is disabled, when the device or page cannot give a position. */
  protected readonly locationUnsupportedKey = computed(() => {
    const support = this.location.support();
    return support === 'ok' ? null : `location.errors.${support}`;
  });

  /** The user can put a point on themselves: they have a position and room for a point. */
  protected readonly canPlaceMyPosition = computed(
    () => !!this.location.fix() && this.store.points().length < MAX_POINTS,
  );

  protected readonly startPoint = computed(
    () => this.store.points()[0] ?? null,
  );
  protected readonly endPoint = computed(() => {
    const points = this.store.points();
    return points.length >= 2 ? points[points.length - 1] : null;
  });
  protected readonly startLabel = computed(() => {
    const point = this.startPoint();
    return point ? this.pointText(point) : null;
  });
  protected readonly endLabel = computed(() => {
    const point = this.endPoint();
    return point ? this.pointText(point) : null;
  });
  /** The points between the start and the end, with their place in the whole list. */
  protected readonly stops = computed(() =>
    this.store
      .points()
      .slice(1, -1)
      .map((point, i) => ({ point, index: i + 1 })),
  );
  /**
   * The empty field of a stop being added, by the place it will take in the points: it joins the
   * route once a place is picked.
   */
  protected readonly newStopAt = signal<number | null>(null);
  protected readonly canAddStop = computed(() => {
    const count = this.store.points().length;
    return count >= 2 && count < MAX_POINTS;
  });
  protected readonly addingAt = computed(() => {
    const at = this.newStopAt();
    if (at === null || !this.canAddStop()) return null;
    return at >= 1 && at < this.store.points().length ? at : null;
  });
  private readonly newStopField = viewChild<PlaceField>('newStop');
  /** The field waiting for the user's position, until the device gives it or fails. */
  private readonly positionTarget = signal<PositionTarget | null>(null);
  private readonly injector = inject(Injector);
  /** The menu opened by a right click or a long press: where, and at which pixel. */
  protected readonly menu = signal<{
    point: LngLat;
    x: number;
    y: number;
  } | null>(null);

  /** The dialog that asks how to close the loop. */
  protected readonly loopDialogOpen = signal(false);
  protected readonly loopStep = signal<'choose' | 'distance'>('choose');
  protected readonly loopKm = signal(LOOP_DISTANCE_DEFAULT_METERS / 1000);
  /** Climb asked in the dialog, in meters; empty text means none. */
  protected readonly loopAscent = signal('');
  /** The direction asked in the dialog; empty leaves it to the engine. */
  protected readonly loopDirection = signal<LoopDirection | ''>('');
  protected readonly directions = LOOP_DIRECTIONS;
  protected readonly ascentMax = LOOP_ASCENT_MAX_METERS;
  protected readonly distanceMinKm = LOOP_DISTANCE_MIN_METERS / 1000;
  protected readonly distanceMaxKm = LOOP_DISTANCE_MAX_METERS / 1000;
  protected readonly canClose = computed(
    () =>
      this.store.points().length >= 1 &&
      this.store.points().length < MAX_POINTS &&
      !this.store.isLoop(),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly transloco = inject(TranslocoService);
  /** The active language, emitted only after its translations are loaded. */
  private readonly loadedLanguage = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((language) =>
        this.transloco.load(language).pipe(map(() => language)),
      ),
    ),
    { initialValue: null },
  );
  private readonly createDriver = inject(PLANNER_MAP_DRIVER);
  private readonly driver = signal<PlannerMapDriver | null>(null);
  private destroyed = false;

  constructor() {
    // Starts recomputing the route whenever the inputs change.
    inject(RoutePlanner);
    // Finds the address of the start and the end when they were not searched.
    inject(PointNamer);

    // "My position" asked in a field waits for the device, and gives up when it fails.
    effect(() => {
      const target = this.positionTarget();
      if (target === null) return;
      const fix = this.location.fix();
      const watching = this.location.watching();
      untracked(() => {
        if (!fix && watching) return;
        this.positionTarget.set(null);
        if (fix) this.placeAtPosition(target, fix.position);
      });
    });

    // The empty field of a new stop does not outlive a change of the points: its place is gone.
    effect(() => {
      this.store.points();
      untracked(() => this.newStopAt.set(null));
    });

    // Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, wherever the focus is but in a field.
    const document = inject(DOCUMENT);
    const onKeydown = (event: KeyboardEvent) => this.onHistoryKey(event);
    document.addEventListener('keydown', onKeydown);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('keydown', onKeydown),
    );

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      // Leaving the planner stops asking the device for positions.
      this.location.stop();
      this.driver()?.destroy();
    });

    effect(() => {
      const driver = this.driver();
      const points = this.store.points();
      if (!driver) return;
      const language = this.loadedLanguage();
      if (!language) return;
      const loop = isLoopOf(points);
      driver.setMarkers(
        points.flatMap((lngLat, index) => {
          const role = pointRole(index, points.length);
          // A loop is drawn once: its end sits under its start.
          if (loop && role === 'end') return [];
          return [
            {
              lngLat,
              role,
              label:
                loop && role === 'start'
                  ? '↻'
                  : role === 'start'
                    ? 'A'
                    : role === 'end'
                      ? 'B'
                      : `${index}`,
              ariaLabel: this.pointName(index),
              loop: loop && role === 'start',
              closable:
                role === 'start' && this.canClose()
                  ? this.transloco.translate('planner.loop.hint', {}, language)
                  : undefined,
            },
          ];
        }),
      );
    });

    // A removed point can be put back for a few seconds.
    effect((onCleanup) => {
      if (!this.store.removed()) return;
      const timer = setTimeout(() => this.store.forgetRemoved(), UNDO_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // The menu takes the focus when it opens, like the dialog below.
    effect(() => {
      if (!this.menu()) return;
      queueMicrotask(() =>
        this.host.nativeElement
          .querySelector<HTMLElement>('.map-menu button')
          ?.focus(),
      );
    });

    // The dialog takes the focus when it opens, so the keyboard works at once.
    effect(() => {
      if (!this.loopDialogOpen()) {
        untracked(() => this.loopStep.set('choose'));
        return;
      }
      queueMicrotask(() =>
        this.host.nativeElement
          .querySelector<HTMLElement>('.loop-dialog button:not([disabled])')
          ?.focus(),
      );
    });

    // The ghost under the mouse says what the next click creates.
    effect(() => {
      const driver = this.driver();
      const role = this.store.nextRole();
      const count = this.store.points().length;
      const language = this.loadedLanguage();
      if (!driver) return;
      if (!language) {
        driver.setGhost(null);
        return;
      }
      driver.setGhost({
        role,
        label: role === 'start' ? 'A' : role === 'end' ? 'B' : `${count - 1}`,
        text: this.transloco.translate(`planner.ghost.${role}`, {}, language),
      });
    });

    // Shows a route opened from the saved list. The driver may come later than the request.
    effect(() => {
      const driver = this.driver();
      const view = this.store.viewRequest();
      if (driver && view) driver.fitRoute(view.geometry);
    });

    // The user's own position, when they share it.
    effect(() => {
      const driver = this.driver();
      const fix = this.location.fix();
      driver?.setLocation(fix);
    });

    // The dot on the map follows the cursor of the profile.
    effect(() => {
      const driver = this.driver();
      const geometry = this.store.selectedGeometry();
      const index = this.store.cursor();
      const point = index === null ? undefined : geometry[index];
      driver?.setCursor(point ? [point[0], point[1]] : null);
    });

    // The stretch picked on the profile stands out on the map.
    effect(() => {
      const driver = this.driver();
      const stretch = this.store.stretch();
      driver?.setHighlight(
        stretch
          ? this.store.selectedGeometry().slice(stretch.from, stretch.to + 1)
          : null,
      );
    });

    effect(() => {
      this.driver()?.setPreview(this.store.preview());
    });

    // The route of a drag arrived: the place the pointer reached meanwhile is next.
    effect(() => {
      this.store.status();
      untracked(() => this.flushDrag());
    });

    effect(() => {
      const driver = this.driver();
      const routes = this.store.routes();
      const selected = this.store.selectedIndex();
      driver?.setRoutes(
        routes.map((route) => route.geometry),
        selected,
      );
    });
  }

  protected async onMapReady(map: MapLike): Promise<void> {
    try {
      const driver = await this.createDriver(map, {
        onClick: (point) => this.store.addPoint(point),
        onSelectRoute: (index) => this.store.selectRoute(index),
        onCloseLoop: () => this.openLoopDialog(),
        onInsertPoint: (hit, to) => this.insertOnRoute(hit, to),
        onContextMenu: (point, screen) =>
          this.menu.set({ point, x: screen.x, y: screen.y }),
        onMovePoint: (index, point) => this.dropPoint(index, point),
        onDragStart: () => this.startDrag(),
        onDragPoint: (index, point) =>
          this.dragTo({ kind: 'move', index, point }),
        onDragInsert: (hit, to) => this.dragInsert(hit, to),
        onRemovePoint: (index) => this.store.removePoint(index),
        onHoverRoute: (point) => this.hoverRoute(point),
      });
      if (this.destroyed) {
        driver.destroy();
        return;
      }
      this.driver.set(driver);
    } catch (error) {
      console.error('Planner could not attach to the map', error);
    }
  }

  /** A waypoint dropped from the route goes in the segment it was dragged from. */
  private insertOnRoute(hit: LngLat, to: LngLat): void {
    if (this.store.dragging()) {
      const index = this.insertAt;
      this.stopLiveDrag();
      if (index === null || index === undefined) {
        this.store.cancelDrag();
      } else {
        this.store.dragTo({ kind: 'insert', index, point: to });
        this.store.endDrag();
      }
      return;
    }
    const index = insertionIndex(
      this.store.selectedGeometry(),
      this.store.points(),
      hit,
    );
    if (index !== null) this.store.insertPoint(index, to);
  }

  /** Where the drag in progress goes next, kept until the route can be asked again. */
  private pendingDrag: DragChange | null = null;
  private dragTimer: ReturnType<typeof setTimeout> | undefined;
  private dragSentAt = 0;
  /** Where the route being dragged gets its new waypoint; `null` when it has no place for one. */
  private insertAt: number | null | undefined;

  private startDrag(): void {
    this.stopLiveDrag();
    this.store.startDrag();
    // The first moves of a drag are too short to be worth a route.
    this.dragSentAt = Date.now() - LIVE_DRAG_INTERVAL_MS / 2;
  }

  /** The route is dragged from `hit`: the segment is found once, on the route the drag started from. */
  private dragInsert(hit: LngLat, to: LngLat): void {
    if (!this.store.dragging()) return;
    if (this.insertAt === undefined) {
      this.insertAt = insertionIndex(
        this.store.selectedGeometry(),
        this.store.points(),
        hit,
      );
    }
    if (this.insertAt !== null) {
      this.dragTo({ kind: 'insert', index: this.insertAt, point: to });
    }
  }

  /**
   * The point being dragged moved. The route follows, but not at every move: the latest place
   * waits for the previous answer and for {@link LIVE_DRAG_INTERVAL_MS} since the last request.
   */
  private dragTo(change: DragChange): void {
    if (!this.store.dragging()) return;
    this.pendingDrag = change;
    this.flushDrag();
  }

  private flushDrag(): void {
    const change = this.pendingDrag;
    if (!change || !this.store.dragging()) return;
    // The answer on its way is shown first: the status effect comes back here.
    if (this.store.status() === 'loading') return;
    const wait = this.dragSentAt + LIVE_DRAG_INTERVAL_MS - Date.now();
    if (wait > 0) {
      this.dragTimer ??= setTimeout(() => {
        this.dragTimer = undefined;
        this.flushDrag();
      }, wait);
      return;
    }
    this.pendingDrag = null;
    this.dragSentAt = Date.now();
    this.store.dragTo(change);
  }

  private stopLiveDrag(): void {
    clearTimeout(this.dragTimer);
    this.dragTimer = undefined;
    this.pendingDrag = null;
    this.insertAt = undefined;
  }

  /** A marker was dropped: the end of a drag, in one step of history. */
  private dropPoint(index: number, point: LngLat): void {
    if (!this.store.dragging()) {
      this.store.movePoint(index, point);
      return;
    }
    this.stopLiveDrag();
    this.store.dragTo({ kind: 'move', index, point });
    this.store.endDrag();
  }

  /** Escape during a drag puts the point and the route back. */
  private cancelDrag(): void {
    this.stopLiveDrag();
    this.driver()?.cancelDrag();
    this.store.cancelDrag();
  }

  /** Hovering the route on the map moves the profile's cursor to the nearest point. */
  private hoverRoute(point: [number, number] | null): void {
    if (!point) {
      this.store.cursor.set(null);
      return;
    }
    const profile = buildProfile(this.store.selectedGeometry());
    this.store.cursor.set(profile ? sampleNearest(profile, point).index : null);
  }

  /** "Start", "Waypoint 2" or "End", in the UI language. */
  /** Index of the point being dragged in the list, and of the row it would take the place of. */
  protected readonly dragFrom = signal<number | null>(null);
  protected readonly dragOver = signal<number | null>(null);

  protected onPointDragStart(event: DragEvent, index: number): void {
    this.dragFrom.set(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox starts no drag without data.
      event.dataTransfer.setData('text/plain', String(index));
      // The whole row follows the pointer, not the grip alone.
      const row = (event.target as Element | null)?.closest?.('li');
      if (row) event.dataTransfer.setDragImage?.(row, 0, 0);
    }
  }

  protected onPointDragOver(event: DragEvent, index: number): void {
    if (this.dragFrom() === null) return;
    // Allows the drop here.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOver.set(index);
  }

  protected onPointDrop(event: DragEvent, index: number): void {
    event.preventDefault();
    // A place dropped as text must not end up in the field of the stop.
    event.stopPropagation();
    const from = this.dragFrom();
    this.endPointDrag();
    if (from !== null) this.store.reorderPoint(from, index);
  }

  protected endPointDrag(): void {
    this.dragFrom.set(null);
    this.dragOver.set(null);
  }

  protected pointName(index: number): string {
    // Reading this signal makes templates and effects follow language changes. It only changes
    // once the language file is loaded: translating earlier would return the raw key.
    const language = this.loadedLanguage();
    if (!language) return '';
    const role = pointRole(index, this.store.points().length);
    // The language is passed explicitly: the active one may already be a newer, unloaded one.
    return this.transloco.translate(
      `planner.points.${role}`,
      { n: index },
      language,
    );
  }

  /** The name of the place when it is known, its coordinates otherwise. */
  protected pointText(point: LngLat): string {
    return this.store.labelOf(point) ?? this.coordinates(point[0], point[1]);
  }

  /** A place picked in the start field: it becomes the start and the map goes there. */
  protected pickStart(place: FoundPlace): void {
    this.store.setStart(place.point);
    this.store.setLabel(place.point, place.label);
    this.driver()?.centerOn(place.point);
  }

  /** A place picked in the end field. Without a start there is no end yet: the field is blocked. */
  protected pickEnd(place: FoundPlace): void {
    if (this.store.points().length === 0) return;
    this.store.setEnd(place.point);
    this.store.setLabel(place.point, place.label);
    this.driver()?.centerOn(place.point);
  }

  /**
   * "My position" picked in a field: the point goes to the position, at once when it is known,
   * else as soon as the device gives it (the user may have to allow it first).
   */
  protected usePosition(target: PositionTarget): void {
    this.location.start();
    this.positionTarget.set(target);
  }

  private placeAtPosition(target: PositionTarget, point: LngLat): void {
    const count = this.store.points().length;
    if (target === 'start') this.store.setStart(point);
    else if (target === 'end') this.store.setEnd(point);
    else if (target === 'new') {
      const at = this.addingAt();
      this.newStopAt.set(null);
      if (at === null) return;
      this.store.insertPoint(at, point);
    } else if (target > 0 && target < count - 1)
      this.store.movePoint(target, point);
    else return;
    this.driver()?.centerOn(point);
  }

  /** A place picked in the field of a stop: the stop moves there. */
  protected pickStop(index: number, place: FoundPlace): void {
    this.store.movePoint(index, place.point);
    this.store.setLabel(place.point, place.label);
    this.driver()?.centerOn(place.point);
  }

  /** Opens an empty field before the point at this place, for a stop to search. */
  protected addStop(at: number): void {
    this.newStopAt.set(at);
    afterNextRender(() => this.newStopField()?.focus(), {
      injector: this.injector,
    });
  }

  /** A place picked in the empty field: the new stop goes where the field was opened. */
  protected pickNewStop(place: FoundPlace): void {
    const at = this.addingAt();
    this.newStopAt.set(null);
    if (at === null) return;
    this.store.insertPoint(at, place.point);
    this.store.setLabel(place.point, place.label);
    this.driver()?.centerOn(place.point);
  }

  /** Applies a choice of the map menu at the place where it was opened. */
  protected place(choice: 'start' | 'stop' | 'end'): void {
    const menu = this.menu();
    this.menu.set(null);
    if (!menu) return;
    if (choice === 'start') this.store.setStart(menu.point);
    else if (choice === 'end') this.store.setEnd(menu.point);
    else this.store.addPoint(menu.point);
  }

  /** Puts a point on the user, the way a click on the map would (start, stop or end). */
  protected placeMyPosition(): void {
    this.menu.set(null);
    const fix = this.location.fix();
    if (fix) this.store.addPoint(fix.position);
  }

  /** With only the start placed there is one way to close the loop: go straight to its length. */
  protected openLoopDialog(): void {
    this.loopStep.set(this.store.points().length >= 2 ? 'choose' : 'distance');
    this.loopDialogOpen.set(true);
  }

  protected closeLoop(mode?: LoopMode): void {
    this.store.closeLoop(mode);
    this.loopDialogOpen.set(false);
  }

  protected drawLoopByDistance(): void {
    const km = this.loopKm();
    const meters = Number.isFinite(km)
      ? Math.round(km * 1000)
      : LOOP_DISTANCE_DEFAULT_METERS;
    const ascent = this.loopAscent().trim();
    const direction = this.loopDirection();
    this.closeLoop({
      mode: 'distance',
      distanceMeters: Math.min(
        LOOP_DISTANCE_MAX_METERS,
        Math.max(LOOP_DISTANCE_MIN_METERS, meters),
      ),
      ...(ascent !== '' && Number.isFinite(Number(ascent))
        ? {
            ascentMeters: Math.min(
              LOOP_ASCENT_MAX_METERS,
              Math.max(0, Math.round(Number(ascent))),
            ),
          }
        : {}),
      ...(direction ? { direction } : {}),
    });
  }

  protected setLoopDirection(value: string): void {
    this.store.setLoopDirection(
      (LOOP_DIRECTIONS as readonly string[]).includes(value)
        ? (value as LoopDirection)
        : null,
    );
  }

  protected setLoopKm(value: string): void {
    this.store.setLoopDistance(Number(value) * 1000);
  }

  /** `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` and `Ctrl+Y` redo. A field keeps its own undo. */
  private onHistoryKey(event: KeyboardEvent): void {
    if (this.store.dragging()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelDrag();
      }
      // Nothing is undone or redone in the middle of a drag.
      return;
    }
    if (event.defaultPrevented || event.altKey) return;
    if (!(event.ctrlKey || event.metaKey) || this.loopDialogOpen()) return;
    const target = event.target as Element | null;
    if (
      target?.closest?.(
        'input:not([type=radio]):not([type=checkbox]):not([type=button]), textarea, select, vl-profile-select, [contenteditable=""], [contenteditable="true"]',
      )
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) this.undo();
    else if (
      (key === 'z' && event.shiftKey) ||
      (key === 'y' && !event.shiftKey)
    ) {
      this.redo();
    } else return;
    event.preventDefault();
  }

  protected undo(): void {
    this.store.undo();
  }

  protected redo(): void {
    this.store.redo();
  }

  protected setLoopAscent(value: string): void {
    this.store.setLoopAscent(value.trim() === '' ? null : Number(value));
  }

  protected selectProfile(profile: Profile): void {
    this.store.setProfile(profile);
  }

  protected selectAlternatives(event: Event): void {
    this.store.setAlternatives(
      Number((event.target as HTMLSelectElement).value),
    );
  }

  protected coordinates(lon: number, lat: number): string {
    const options = { minimumFractionDigits: 4, maximumFractionDigits: 4 };
    return `${this.format.number(lat, options)}, ${this.format.number(lon, options)}`;
  }
}
