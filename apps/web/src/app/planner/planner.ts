import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { map, switchMap } from 'rxjs';
import { FormattingService } from '../core/format/formatting.service';
import type { MapLike } from '../core/map/map-factory';
import { MapView } from '../core/map/map-view';
import {
  PLANNER_MAP_DRIVER,
  type PlannerMapDriver,
} from './planner-map-driver';
import {
  MAX_ALTERNATIVES,
  PROFILES,
  PlannerStore,
  type Profile,
  isLoopOf,
  pointRole,
} from './planner-store';
import { buildProfile, sampleNearest } from './elevation-profile';
import { RoutePlanner } from './route-planner';
import { ElevationPanel } from './elevation-panel';
import { SavedRoutes } from '../saved-routes/saved-routes';

/**
 * The map with its planning panel. Clicks place the start, the end and waypoints; markers can be
 * dragged; the route and its alternatives are computed through the API and drawn on the map.
 */
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
      this.driver()?.destroy();
    });

    effect(() => {
      const driver = this.driver();
      const points = this.store.points();
      if (!driver) return;
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
            },
          ];
        }),
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
