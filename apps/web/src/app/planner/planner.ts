import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
  LOOP_DISTANCE_DEFAULT_METERS,
  LOOP_DISTANCE_MAX_METERS,
  LOOP_DISTANCE_MIN_METERS,
  type LoopMode,
  MAX_POINTS,
  PROFILES,
  PlannerStore,
  type Profile,
  isLoopOf,
  pointRole,
} from './planner-store';
import { buildProfile, sampleNearest } from './elevation-profile';
import { insertionIndex } from './insert-point';
import { RoutePlanner } from './route-planner';
import { ElevationPanel } from './elevation-panel';
import { SavedRoutes } from '../saved-routes/saved-routes';

/**
 * The map with its planning panel. Clicks place the start, the end and waypoints; markers can be
 * dragged; the route and its alternatives are computed through the API and drawn on the map.
 */
/** How long a removed point can be put back. */
const UNDO_MS = 6000;

@Component({
  selector: 'vl-planner',
  imports: [MapView, TranslocoPipe, SavedRoutes, ElevationPanel],
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
  protected readonly distanceMinKm = LOOP_DISTANCE_MIN_METERS / 1000;
  protected readonly distanceMaxKm = LOOP_DISTANCE_MAX_METERS / 1000;
  protected readonly canClose = computed(
    () =>
      this.store.points().length >= 2 &&
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
        onCloseLoop: () => this.loopDialogOpen.set(true),
        onInsertPoint: (hit, to) => this.insertOnRoute(hit, to),
        onContextMenu: (point, screen) =>
          this.menu.set({ point, x: screen.x, y: screen.y }),
        onMovePoint: (index, point) => this.store.movePoint(index, point),
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
    const index = insertionIndex(
      this.store.selectedGeometry(),
      this.store.points(),
      hit,
    );
    if (index !== null) this.store.insertPoint(index, to);
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

  protected closeLoop(mode?: LoopMode): void {
    this.store.closeLoop(mode);
    this.loopDialogOpen.set(false);
  }

  protected drawLoopByDistance(): void {
    const km = this.loopKm();
    const meters = Number.isFinite(km)
      ? Math.round(km * 1000)
      : LOOP_DISTANCE_DEFAULT_METERS;
    this.closeLoop({
      mode: 'distance',
      distanceMeters: Math.min(
        LOOP_DISTANCE_MAX_METERS,
        Math.max(LOOP_DISTANCE_MIN_METERS, meters),
      ),
    });
  }

  protected setLoopKm(value: string): void {
    this.store.setLoopDistance(Number(value) * 1000);
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
