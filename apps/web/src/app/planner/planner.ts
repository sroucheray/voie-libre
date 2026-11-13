import { ComputeBadge } from './compute-badge';
import { SheetDrag, type SheetRelease } from '../core/gestures/sheet-drag';
import {
  nextState,
  sheetHeights,
  snapTo,
  stepState,
  type SheetState,
} from '../core/gestures/sheet-snap';
import { FullscreenMap } from '../core/fullscreen/fullscreen-map';
import { ProfileMini } from './profile-mini';
import { VerticalSwipe } from '../core/gestures/vertical-swipe';
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
import { MapLayers } from '../core/map/map-layers';
import { distanceFor } from './loop-duration';
import { LoopSpeeds } from './loop-speeds';
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
import { Icon } from '../core/icons/icon';
import { buildProfile, sampleNearest } from './elevation-profile';
import { insertionIndex } from './insert-point';
import { SNAP_MAX_METERS, SNAP_MAX_PIXELS } from './snap-to-way';
import { WaySnapper } from './way-snapper';
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
/** How long the message of a refused point stays. */
const REFUSED_MS = 4000;

/** Where "My position" was asked: the start, the end, the stop at an index, or the new stop. */
type PositionTarget = 'start' | 'end' | 'new' | number;

/** Least time between two routes asked for during a drag: under the API's limit for `POST /route`. */
export const LIVE_DRAG_INTERVAL_MS = 600;

/**
 * A computation shows itself (a badge on the map, the routes faded) only when it lasts longer than
 * this: an edit that comes back at once changes nothing on screen but the route.
 */
export const COMPUTING_DELAY_MS = 300;

/** Where a drag in progress puts its point. */
type DragChange = { kind: 'move' | 'insert'; index: number; point: LngLat };

/** The height of the sheet when only its handle and summary show, in rem (see planner.scss). */
const SHEET_PEEK_REM = 4.25;

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
    Icon,
    VerticalSwipe,
    SheetDrag,
    ProfileMini,
    ComputeBadge,
  ],
  templateUrl: './planner.html',
  styleUrl: './planner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A phone's map with the whole screen: the sheet goes and what floated above it comes down.
  host: { '[class.map-fullscreen]': 'fullscreen.active()' },
})
export class Planner {
  protected readonly store = inject(PlannerStore);
  protected readonly fullscreen = inject(FullscreenMap);
  protected readonly format = inject(FormattingService);
  protected readonly location = inject(LocationStore);
  private readonly mapLayers = inject(MapLayers);
  protected readonly profiles = PROFILES;
  protected readonly alternativeChoices = Array.from(
    { length: MAX_ALTERNATIVES },
    (_, i) => i + 1,
  );

  /** True when a route has been computing for more than {@link COMPUTING_DELAY_MS} (never during a drag). */
  protected readonly computing = signal(false);

  /** A finger, not a mouse: a point is put by a long press, so the help bar says so. */
  private readonly touchScreen =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  /** What the help bar says: it depends on how far the route is. */
  protected readonly helpKey = computed(() => {
    const count = this.store.points().length;
    const touch = this.touchScreen ? 'Touch' : '';
    if (this.store.dragging()) return 'planner.hint.dragging';
    if (this.reorder()) return 'planner.hint.reordering';
    if (count === 0) return `planner.hint.start${touch}`;
    if (count === 1) return `planner.hint.end${touch}`;
    return this.store.isLoop()
      ? `planner.hint.loop${touch}`
      : `planner.hint.route${touch}`;
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
  /** The saved routes: the form that saves the planned route is drawn here, with the route. */
  protected readonly savedRoutes = viewChild(SavedRoutes);
  /** The field waiting for the user's position, until the device gives it or fails. */
  private readonly positionTarget = signal<PositionTarget | null>(null);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  /** The menu opened by a right click or a long press: where, and at which pixel. */
  protected readonly menu = signal<{
    point: LngLat;
    x: number;
    y: number;
  } | null>(null);

  /** The dialog that asks how to close the loop. */
  /** The panel's section, and (on a phone) whether the bottom sheet is open. */
  protected readonly tab = signal<'route' | 'saved'>('route');
  /** The height of the sheet on a phone: peek (handle and summary), half or full. */
  protected readonly sheetState = signal<SheetState>('peek');
  /** The route the one-line summary of the closed sheet is about: the selected alternative, if any. */
  protected readonly peekRoute = computed(
    () => this.store.routes()[this.store.selectedIndex()] ?? null,
  );
  protected readonly sheetOpen = computed(() => this.sheetState() !== 'peek');
  /** The height in pixels while the handle is dragged; null otherwise (the state decides). */
  protected readonly sheetDragHeight = signal<number | null>(null);
  private sheetDrag: { start: number; stage: number; peek: number } | null =
    null;
  protected readonly loopDialogOpen = signal(false);
  protected readonly loopStep = signal<'choose' | 'distance'>('choose');
  protected readonly loopKm = signal(LOOP_DISTANCE_DEFAULT_METERS / 1000);
  /** Whether the dialog asks the length of the loop as a distance or as a duration. */
  protected readonly loopBy = signal<'distance' | 'duration'>('distance');
  /** The duration asked in the dialog, in minutes. */
  protected readonly loopMinutes = signal(120);
  private readonly loopSpeeds = inject(LoopSpeeds);
  /** The speed of the profile in km/h: what turns the duration into a distance. */
  protected readonly loopSpeed = computed(() =>
    this.loopSpeeds.speed(this.store.profile()),
  );
  /** The distance in km a duration at the speed of the profile comes to. */
  protected readonly loopKmFromDuration = computed(
    () => distanceFor(this.loopMinutes(), this.loopSpeed()) / 1000,
  );
  /** Climb asked in the dialog, in meters; empty text means none. */
  protected readonly loopAscent = signal('');
  /** The direction asked in the dialog; empty leaves it to the engine. */
  protected readonly loopDirection = signal<LoopDirection | ''>('');
  protected readonly directions = LOOP_DIRECTIONS;
  protected readonly ascentMax = LOOP_ASCENT_MAX_METERS;
  protected readonly distanceMinKm = LOOP_DISTANCE_MIN_METERS / 1000;
  protected readonly distanceMaxKm = LOOP_DISTANCE_MAX_METERS / 1000;
  /**
   * What the loop button says: with only a start it draws a loop of a set length from there; with a
   * route it closes it. The hint under the button and the title of the dialog use the same key
   * (`<key>Hint`).
   */
  protected readonly loopLabelKey = computed(() =>
    this.store.points().length >= 2
      ? 'planner.loop.close'
      : 'planner.loop.make',
  );

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
  private readonly snapper = inject(WaySnapper);
  /** True for a few seconds after a point was refused: no way close enough for the profile. */
  protected readonly refused = signal(false);
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
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      this.stopReorderListening?.();
    });

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

    // The message of a refused point goes away by itself.
    effect((onCleanup) => {
      if (!this.refused()) return;
      const timer = setTimeout(() => this.refused.set(false), REFUSED_MS);
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
      const language = this.loadedLanguage();
      if (!driver) return;
      if (!language) {
        driver.setGhost(null);
        return;
      }
      driver.setGhost({
        role,
        // A stop is a "+": where it lands in the order depends on where the click falls on the
        // route, and its number is only known once it is placed.
        label: role === 'start' ? 'A' : role === 'end' ? 'B' : '+',
        text: this.transloco.translate(`planner.ghost.${role}`, {}, language),
        refusedText: this.transloco.translate(
          'planner.snap.refused',
          {},
          language,
        ),
      });
    });

    // Shows a route opened from the saved list. The driver may come later than the request.
    effect(() => {
      const driver = this.driver();
      const view = this.store.viewRequest();
      if (driver && view) driver.fitRoute(view.geometry, view.animate);
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

    // A computation that lasts is shown: a badge on the map, and the routes on screen faded. A drag
    // asks for a stretch every moment and has its own feedback (the point follows the pointer).
    effect((onCleanup) => {
      const loading =
        this.store.status() === 'loading' && !this.store.dragging();
      if (!loading) {
        untracked(() => this.computing.set(false));
        return;
      }
      const timer = setTimeout(
        () => this.computing.set(true),
        COMPUTING_DELAY_MS,
      );
      onCleanup(() => clearTimeout(timer));
    });
    effect(() => {
      this.driver()?.setStale(this.computing());
    });

    // The selected route in the colours of what it rides on, when the user asked for it.
    effect(() => {
      const driver = this.driver();
      const surfaces = this.mapLayers.surface()
        ? this.store.selectedSurfaces()
        : null;
      driver?.setSurfaces(
        surfaces === null ? null : this.store.selectedGeometry(),
        surfaces,
      );
    });
  }

  protected async onMapReady(map: MapLike): Promise<void> {
    try {
      const driver = await this.createDriver(map, {
        onClick: (point) =>
          this.placeOnWay(point, (place) => this.addStopAt(place)),
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
        ghostAt: (point) => this.ghostAt(point),
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

  /**
   * The farthest a point may be from a way to snap to it, around `point`: {@link SNAP_MAX_METERS}
   * on the ground, and no more than {@link SNAP_MAX_PIXELS} on screen.
   */
  private snapLimit(point: LngLat): number {
    const scale = this.driver()?.metersPerPixel(point) ?? Infinity;
    return Math.min(SNAP_MAX_METERS, SNAP_MAX_PIXELS * scale);
  }

  /** Where a point placed at `point` lands, if the ways around are known already. */
  private landing(point: LngLat): LngLat | null | undefined {
    return this.snapper.peek(
      point,
      this.store.profile(),
      this.snapLimit(point),
    );
  }

  /**
   * Places a point given on the map: `apply` gets where it lands (on the nearest way, for the
   * profiles that need one). With no way close enough the point is refused: a message says so and
   * `refuse` runs. At once when the ways around are known, else after their tile is read.
   */
  private placeOnWay(
    point: LngLat,
    apply: (place: LngLat) => void,
    refuse?: () => void,
  ): void {
    const finish = (place: LngLat | null) => {
      if (place) {
        this.refused.set(false);
        apply(place);
      } else {
        this.refused.set(true);
        refuse?.();
      }
    };
    const known = this.landing(point);
    if (known !== undefined) {
      finish(known);
      return;
    }
    void this.snapper
      .snap(point, this.store.profile(), this.snapLimit(point))
      .then((place) => {
        if (!this.destroyed) finish(place);
      });
  }

  /** Where the ghost of the next point shows: the landing place, as far as it is known. */
  private ghostAt(point: LngLat): { point: LngLat; refused: boolean } {
    const known = this.landing(point);
    if (known === undefined) {
      // Read the ways around for the next move of the pointer.
      void this.snapper.snap(
        point,
        this.store.profile(),
        this.snapLimit(point),
      );
    }
    return { point: known ?? point, refused: known === null };
  }

  /** A waypoint dropped from the route goes in the segment it was dragged from. */
  private insertOnRoute(hit: LngLat, to: LngLat): void {
    if (this.store.dragging()) {
      const index = this.insertAt;
      this.stopLiveDrag();
      if (index === null || index === undefined) {
        this.store.cancelDrag();
        return;
      }
      this.placeOnWay(
        to,
        (place) => {
          if (!this.store.dragging()) return;
          this.store.dragTo({ kind: 'insert', index, point: place });
          this.store.endDrag();
        },
        () => this.cancelDrag(),
      );
      return;
    }
    const index = insertionIndex(
      this.store.selectedGeometry(),
      this.store.points(),
      hit,
    );
    if (index !== null) {
      this.placeOnWay(to, (place) => this.store.insertPoint(index, place));
    }
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
    const place = this.landing(change.point);
    if (place === undefined) {
      // The ways around are being read: this place is tried again once they are known.
      void this.snapper
        .snap(change.point, this.store.profile(), this.snapLimit(change.point))
        .then(() => {
          if (this.pendingDrag === change) this.flushDrag();
        });
      return;
    }
    this.pendingDrag = null;
    // No way close enough: the route stays on the last place that had one.
    if (!place) return;
    this.dragSentAt = Date.now();
    this.store.dragTo({ ...change, point: place });
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
      this.placeOnWay(
        point,
        (place) => this.store.movePoint(index, place),
        // The marker goes back where its point is.
        () => this.driver()?.cancelDrag(),
      );
      return;
    }
    this.stopLiveDrag();
    this.placeOnWay(
      point,
      (place) => {
        if (!this.store.dragging()) return;
        this.store.dragTo({ kind: 'move', index, point: place });
        this.store.endDrag();
      },
      () => this.cancelDrag(),
    );
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

  /**
   * A stop being moved in the list: the point it started from and the place it would take (both
   * indexes in the points). The rows show the future order at once; the store changes on release.
   */
  protected readonly reorder = signal<{ from: number; to: number } | null>(
    null,
  );
  /** What a screen reader hears after a stop moved by keyboard. */
  protected readonly moveAnnouncement = signal('');
  private stopReorderListening: (() => void) | null = null;

  /** The place a row takes in the list while a stop is being moved. */
  protected numberOf(index: number): number {
    const move = this.reorder();
    if (!move) return index;
    const { from, to } = move;
    if (index === from) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (from > to && index >= to && index < from) return index + 1;
    return index;
  }

  protected onGripDown(event: PointerEvent, index: number): void {
    if (event.button !== 0 || this.reorder()) return;
    event.preventDefault();
    this.newStopAt.set(null);
    this.reorder.set({ from: index, to: index });
    const document = this.document;
    const onMove = (move: PointerEvent) => this.moveReorderTo(move.clientY);
    const onUp = () => this.endReorder(true);
    const onCancel = () => this.endReorder(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    this.stopReorderListening = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }

  /** The stop takes the place after the rows whose middle is above the pointer. */
  private moveReorderTo(y: number): void {
    const move = this.reorder();
    if (!move) return;
    const rows = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('.points__stop'),
    );
    let above = 0;
    rows.forEach((row, i) => {
      if (i + 1 === move.from) return;
      const box = row.getBoundingClientRect();
      if (box.top + box.height / 2 < y) above++;
    });
    const to = above + 1;
    if (to !== move.to) this.reorder.set({ from: move.from, to });
  }

  /** Release keeps the new order (one recompute); Escape and a cancelled pointer drop it. */
  private endReorder(keep: boolean): void {
    const move = this.reorder();
    this.stopReorderListening?.();
    this.stopReorderListening = null;
    this.reorder.set(null);
    if (keep && move && move.from !== move.to) {
      this.store.reorderPoint(move.from, move.to);
    }
  }

  /** The keyboard moves a stop one place up or down, at once. */
  protected onGripKey(event: KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const to = index + step;
    const total = this.stops().length;
    if (to < 1 || to > total) return;
    this.store.reorderPoint(index, to);
    const language = this.loadedLanguage();
    if (language) {
      this.moveAnnouncement.set(
        this.transloco.translate(
          'planner.points.moved',
          { name: this.pointName(to), n: to, total },
          language,
        ),
      );
    }
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelectorAll<HTMLElement>('.points__stop .point-grip')
          [to - 1]?.focus(),
      { injector: this.injector },
    );
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

  /**
   * Shows a place just picked or placed: the map goes to it when it is the only point, but once
   * there is a route (two points or more) the view takes in all of it, not just the new point.
   */
  private showPlace(point: LngLat): void {
    const points = this.store.points();
    if (points.length >= 2) this.driver()?.fitPoints([...points]);
    else this.driver()?.centerOn(point);
  }

  /** A place picked in the start field: it becomes the start and the map goes there. */
  protected pickStart(place: FoundPlace): void {
    this.store.setStart(place.point);
    this.store.setLabel(place.point, place.label, place.short);
    this.showPlace(place.point);
  }

  /** A place picked in the end field. Without a start there is no end yet: the field is blocked. */
  protected pickEnd(place: FoundPlace): void {
    if (this.store.points().length === 0) return;
    this.store.setEnd(place.point);
    this.store.setLabel(place.point, place.label, place.short);
    this.showPlace(place.point);
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
    this.showPlace(point);
  }

  /** A place picked in the field of a stop: the stop moves there. */
  protected pickStop(index: number, place: FoundPlace): void {
    this.store.movePoint(index, place.point, true);
    this.store.setLabel(place.point, place.label, place.short);
    this.showPlace(place.point);
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
    this.store.insertPoint(at, place.point, true);
    this.store.setLabel(place.point, place.label, place.short);
    this.showPlace(place.point);
  }

  /** Applies a choice of the map menu at the place where it was opened. */
  protected place(choice: 'start' | 'stop' | 'end'): void {
    const menu = this.menu();
    this.menu.set(null);
    if (!menu) return;
    this.placeOnWay(menu.point, (place) => {
      if (choice === 'start') this.store.setStart(place);
      else if (choice === 'end') this.store.setEnd(place);
      else this.addStopAt(place);
    });
  }

  /** Puts a point on the user, the way a click on the map would (start, stop or end). */
  protected placeMyPosition(): void {
    this.menu.set(null);
    const fix = this.location.fix();
    if (fix) this.addStopAt(fix.position, true);
  }

  /**
   * Adds a point at `place` the way a click does. With a route on screen the point goes where it
   * belongs: between the two points whose stretch of the route is the closest to it (a click on
   * the route or beside it), like a waypoint dragged out of the route. Otherwise (the start, the
   * end, a route still being computed or in error) it goes where {@link PlannerStore.addPoint}
   * puts it, before the end.
   */
  private addStopAt(place: LngLat, deliberate = false): void {
    const points = this.store.points();
    const index =
      points.length >= 2 && this.store.status() === 'ready'
        ? insertionIndex(this.store.selectedGeometry(), points, place)
        : null;
    if (index === null) this.store.addPoint(place);
    else this.store.insertPoint(index, place, deliberate);
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
    const km =
      this.loopBy() === 'duration' ? this.loopKmFromDuration() : this.loopKm();
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

  protected setLoopSpeed(value: string): void {
    this.loopSpeeds.set(this.store.profile(), value);
  }

  protected setLoopKm(value: string): void {
    this.store.setLoopDistance(Number(value) * 1000);
  }

  /** `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` and `Ctrl+Y` redo. A field keeps its own undo. */
  private onHistoryKey(event: KeyboardEvent): void {
    if (this.reorder()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.endReorder(false);
      }
      return;
    }
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

  /** "Show in Saved" on the confirmation: opens the list with the route that was saved lit. */
  protected openSaved(id: string): void {
    this.openTab('saved');
    this.store.highlightSaved(id);
  }

  protected openTab(tab: 'route' | 'saved'): void {
    this.tab.set(tab);
    this.raiseSheet();
  }

  /** Brings the sheet up to half when it is only a peek. */
  protected raiseSheet(): void {
    if (this.sheetState() === 'peek') this.sheetState.set('half');
  }

  /** A touch of the map takes the half-open sheet back down, to give the map its room. */
  protected lowerSheet(): void {
    if (this.sheetState() === 'half') this.sheetState.set('peek');
  }

  protected cycleSheet(): void {
    this.sheetState.set(nextState(this.sheetState()));
  }

  protected onSheetKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    this.sheetState.set(stepState(this.sheetState(), event.key === 'ArrowUp'));
  }

  protected startSheetDrag(panel: HTMLElement): void {
    const stage = panel.offsetParent?.clientHeight ?? panel.clientHeight;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    this.sheetDrag = {
      start: panel.getBoundingClientRect().height,
      stage,
      peek: SHEET_PEEK_REM * (Number.isFinite(rem) ? rem : 16),
    };
    this.sheetDragHeight.set(this.sheetDrag.start);
  }

  protected moveSheetDrag(up: number): void {
    const drag = this.sheetDrag;
    if (!drag) return;
    this.sheetDragHeight.set(
      Math.min(drag.stage, Math.max(drag.peek, drag.start + up)),
    );
  }

  protected releaseSheetDrag(release: SheetRelease): void {
    const drag = this.sheetDrag;
    this.sheetDrag = null;
    if (!drag) return;
    const height = this.sheetDragHeight() ?? drag.start;
    this.sheetState.set(
      snapTo(
        height,
        release.velocity,
        sheetHeights(drag.stage, drag.peek),
        this.sheetState(),
      ),
    );
    this.sheetDragHeight.set(null);
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
