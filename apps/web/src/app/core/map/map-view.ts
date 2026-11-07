import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../i18n/language.service';
import { OfflineBasemap } from '../offline/offline-basemap';
import { basemapTilesUrl, buildBasemapStyle } from './basemap-style';
import { BASEMAP_URL, LngLat, MAP_FACTORY, MapLike } from './map-factory';

/** Clermont-Ferrand, the test region. */
export const CLERMONT_CENTER: LngLat = [3.087, 45.777];
export const DEFAULT_ZOOM = 11;

const CENTER_EPSILON = 1e-6;
const ZOOM_EPSILON = 1e-3;

/**
 * MapLibre map over the local basemap. `center` and `zoom` are two-way signals: bind them to
 * set the starting view, read them to follow the user, or write them to move the map.
 */
@Component({
  selector: 'vl-map-view',
  imports: [TranslocoPipe],
  templateUrl: './map-view.html',
  styleUrl: './map-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapView {
  readonly center = model<LngLat>(CLERMONT_CENTER);
  readonly zoom = model<number>(DEFAULT_ZOOM);
  /** Emits the map once it is created, for features that draw on it. */
  readonly mapReady = output<MapLike>();

  /** True when the map could not be created, typically because WebGL2 is unavailable. */
  protected readonly failed = signal(false);
  private readonly bearingState = signal(0);
  protected readonly bearing = this.bearingState.asReadonly();
  protected readonly compassRotation = computed(
    () => `rotate(${-this.bearing()}deg)`,
  );

  private readonly container =
    viewChild.required<ElementRef<HTMLElement>>('container');
  private readonly createMap = inject(MAP_FACTORY);
  private readonly basemapUrl = inject(BASEMAP_URL);
  private readonly language = inject(LanguageService);
  private readonly offline = inject(OfflineBasemap);
  private readonly map = signal<MapLike | null>(null);

  constructor() {
    let destroyed = false;
    let created: MapLike | null = null;
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      created?.remove();
    });

    afterNextRender(async () => {
      let map: MapLike;
      try {
        map = await this.createMap({
          container: this.container().nativeElement,
          style: buildBasemapStyle(this.basemapUrl, this.language.current()),
          center: this.center(),
          zoom: this.zoom(),
          offlineTiles: {
            url: basemapTilesUrl(this.basemapUrl),
            reader: this.offline,
          },
        });
      } catch (error) {
        console.error('Map could not be created', error);
        this.failed.set(true);
        return;
      }
      if (destroyed) {
        // The component went away while the map was loading.
        map.remove();
        return;
      }
      created = map;
      map.on('moveend', () => {
        const { lng, lat } = map.getCenter();
        this.center.set([lng, lat]);
        this.zoom.set(map.getZoom());
      });
      map.on('rotate', () => this.bearingState.set(map.getBearing()));
      this.map.set(map);
      this.mapReady.emit(map);
    });

    // Labels follow the UI language. The style is rebuilt only when the language really changes.
    let styledLanguage: string | null = null;
    effect(() => {
      const map = this.map();
      const language = this.language.current();
      if (!map) return;
      if (styledLanguage !== null && styledLanguage !== language) {
        map.setStyle(buildBasemapStyle(this.basemapUrl, language));
      }
      styledLanguage = language;
    });

    // Moves the map when `center` or `zoom` is written from outside.
    effect(() => {
      const map = this.map();
      const [lon, lat] = this.center();
      const zoom = this.zoom();
      if (!map) return;
      const current = map.getCenter();
      const moved =
        Math.abs(current.lng - lon) > CENTER_EPSILON ||
        Math.abs(current.lat - lat) > CENTER_EPSILON;
      const zoomed = Math.abs(map.getZoom() - zoom) > ZOOM_EPSILON;
      if (moved || zoomed) map.jumpTo({ center: [lon, lat], zoom });
    });
  }

  protected zoomIn(): void {
    this.map()?.zoomIn();
  }

  protected zoomOut(): void {
    this.map()?.zoomOut();
  }

  protected resetNorth(): void {
    this.map()?.resetNorth();
  }
}
