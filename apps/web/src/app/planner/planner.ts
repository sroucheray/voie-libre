import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  pointRole,
} from './planner-store';
import { RoutePlanner } from './route-planner';

/**
 * The map with its planning panel. Clicks place the start, the end and waypoints; markers can be
 * dragged; the route and its alternatives are computed through the API and drawn on the map.
 */
@Component({
  selector: 'vl-planner',
  imports: [MapView, TranslocoPipe],
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
      driver.setMarkers(
        points.map((lngLat, index) => {
          const role = pointRole(index, points.length);
          return {
            lngLat,
            role,
            label: role === 'start' ? 'A' : role === 'end' ? 'B' : `${index}`,
            ariaLabel: this.pointName(index),
          };
        }),
      );
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
