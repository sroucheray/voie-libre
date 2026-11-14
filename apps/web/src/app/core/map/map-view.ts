import { Icon } from '../icons/icon';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../i18n/language.service';
import { NetworkStatus } from '../offline/network-status';
import { OfflineBasemap } from '../offline/offline-basemap';
import {
  basemapTilesUrl,
  buildBasemapStyle,
  reliefTilesUrl,
} from './basemap-style';
import { MapLayers, RELIEF_PROBE, type RouteColour } from './map-layers';
import { PALETTE } from './palette';
import {
  FRANCE_BOX,
  readStoredView,
  storeView,
  viewToFit,
} from './initial-view';
import { MapViewport } from './map-viewport';
import { RELIEF_CREDIT_URL, RELIEF_SOURCE_KIND } from './relief-source';
import { viewBox, type Box } from '../offline/area-tiles';
import { WAY_COLORS, WAY_LEVELS } from './way-levels';
import {
  SURFACE_COLORS,
  SURFACE_CODES,
  surfaceKey,
} from './surface-categories';
import {
  BASEMAP_COVERAGE,
  BASEMAP_URL,
  LngLat,
  MAP_FACTORY,
  MapLike,
} from './map-factory';

/**
 * The view a map has until it is told otherwise, and the one a map that has no size yet starts
 * from: the middle of France. The real starting view is chosen when the map is created (the last
 * view of the device, or all of France to fit the screen).
 */
export const DEFAULT_CENTER: LngLat = [2.2, 46.7];
export const DEFAULT_ZOOM = 5;

/** Pixels the page leaves over the map when the first view is chosen (about, to look right). */
const PHONE_WIDTH_PX = 640;
const PANEL_ROOM_PX = 360;
const PHONE_TOP_ROOM_PX = 64;
const PHONE_BOTTOM_ROOM_PX = 120;
const MAP_BUTTONS_ROOM_PX = 64;

const CENTER_EPSILON = 1e-6;
const ZOOM_EPSILON = 1e-3;

/**
 * MapLibre map over the local basemap. `center` and `zoom` are two-way signals: bind them to
 * set the starting view, read them to follow the user, or write them to move the map.
 */
@Component({
  selector: 'vl-map-view',
  imports: [TranslocoPipe, Icon],
  templateUrl: './map-view.html',
  styleUrl: './map-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(keydown.escape)': 'closeLayers()',
  },
})
export class MapView {
  readonly center = model<LngLat>(DEFAULT_CENTER);
  readonly zoom = model<number>(DEFAULT_ZOOM);
  /** Emits the map once it is created, for features that draw on it. */
  readonly mapReady = output<MapLike>();
  /** There is a route to show whole: enables the "whole route" button. */
  readonly canFitRoute = input(false);
  /** The user asks for the whole route on screen. */
  readonly fitRoute = output<void>();
  /** The route on screen does not say what it rides on (so there is nothing to colour). */
  readonly surfaceMissing = input(false);
  /** The route can be calculated again (not a loop kept without its mode). */
  readonly surfaceComputable = input(true);
  /** The user asks for the route to be calculated again, to get what it rides on. */
  readonly computeSurface = output<void>();

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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly probeRelief = inject(RELIEF_PROBE);
  private readonly viewport = inject(MapViewport);
  private readonly coverageOf = inject(BASEMAP_COVERAGE);
  /** The box the basemap archive covers; `null` until known. */
  private readonly coverage = signal<Box | null>(null);
  /** The map is centred where the basemap has no data: grey, which this explains. */
  protected readonly outsideCoverage = computed(() => {
    const box = this.coverage();
    const [lon, lat] = this.center();
    return (
      !!box && (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3])
    );
  });
  protected readonly layers = inject(MapLayers);
  /** Where the hillshade gets its elevations: the public terrain tiles, or our own file. */
  protected readonly reliefKind = inject(RELIEF_SOURCE_KIND);
  protected readonly reliefCreditUrl = RELIEF_CREDIT_URL;
  /**
   * The elevation tiles can be had: at once for the public source, once the archive is known to
   * exist for the local one.
   */
  protected readonly reliefAvailable = signal(this.reliefKind === 'public');
  /** The hillshade is drawn: the user wants it and its tiles exist. */
  protected readonly reliefShown = computed(
    () => this.reliefAvailable() && this.layers.relief(),
  );
  /** The profile whose suited ways can be drawn (`road`, `gravel`, `trail`); none, none drawn. */
  readonly waysProfile = input<string | null>(null);
  /** The ways are drawn: the user wants them and the profile is known. */
  protected readonly waysShown = computed(
    () => (this.layers.ways() ? this.waysProfile() : null) ?? null,
  );
  protected readonly wayLevels = WAY_LEVELS.map((level) => ({
    level,
    color: WAY_COLORS[level],
  })).reverse();
  protected readonly surfaceLegend = SURFACE_CODES.map((code) => ({
    code,
    color: SURFACE_COLORS[code],
    key: surfaceKey(code),
  }));
  /** The ways to colour the route, in the order of the panel. */
  protected readonly routeColours: readonly RouteColour[] = [
    'plain',
    'surface',
    'grade',
  ];
  protected readonly gradeLegend = PALETTE.gradeLine.map((color, band) => ({
    band,
    color,
  }));
  protected readonly online = inject(NetworkStatus).online;
  /** The photos are drawn: the user wants them and the device can reach the IGN. */
  protected readonly imageryShown = computed(
    () => this.layers.imagery() && this.online(),
  );
  protected readonly layersOpen = signal(false);

  constructor() {
    let destroyed = false;
    let created: MapLike | null = null;
    const onResize = () => this.measureLayers();
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() =>
      window.removeEventListener('resize', onResize),
    );
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      created?.remove();
    });

    const reliefUrl = reliefTilesUrl(this.basemapUrl);
    afterNextRender(async () => {
      let map: MapLike;
      this.chooseStartingView();
      try {
        map = await this.createMap({
          container: this.container().nativeElement,
          // The relief comes once its file is known to exist: the map does not wait for it.
          style: buildBasemapStyle(this.basemapUrl, this.language.current()),
          center: this.center(),
          zoom: this.zoom(),
          // The local relief archive is read from the device too; the public tiles go through the
          // `vlterrain` protocol, which does the same.
          offlineTiles: [
            basemapTilesUrl(this.basemapUrl),
            ...(this.reliefKind === 'local' ? [reliefUrl] : []),
          ].map((url) => ({ url, reader: this.offline.readerFor(url) })),
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
      const publishView = () => {
        const { lng, lat } = map.getCenter();
        const host = this.container().nativeElement;
        this.viewport.box.set(
          viewBox(
            [lng, lat],
            map.getZoom(),
            host.clientWidth || 1,
            host.clientHeight || 1,
          ),
        );
      };
      publishView();
      map.on('moveend', () => {
        const { lng, lat } = map.getCenter();
        this.center.set([lng, lat]);
        this.zoom.set(map.getZoom());
        // The next visit starts where this one stopped (on this device only).
        storeView([lng, lat], map.getZoom());
        publishView();
      });
      map.on('rotate', () => this.bearingState.set(map.getBearing()));
      this.map.set(map);
      this.mapReady.emit(map);
      void this.coverageOf(basemapTilesUrl(this.basemapUrl)).then((box) => {
        if (!destroyed) this.coverage.set(box);
      });
      if (this.reliefKind === 'local') {
        // The copy on the device is enough: no network is needed to know.
        const available =
          (await this.offline.has(reliefUrl)) ||
          (await this.probeRelief(reliefUrl));
        if (!destroyed) this.reliefAvailable.set(available);
      }
    });

    // Labels follow the UI language and the relief follows the user's choice. The style is
    // rebuilt only when one of them really changes; MapLibre applies the difference.
    let styled: string | null = null;
    effect(() => {
      const map = this.map();
      const language = this.language.current();
      const relief = this.reliefShown();
      const ways = this.waysShown();
      const imagery = this.imageryShown();
      if (!map) return;
      const wanted = `${language}|${relief}|${ways ?? ''}|${imagery}`;
      // The map was created without relief, ways or photos.
      styled ??= `${language}|false||false`;
      if (styled !== wanted) {
        const style = buildBasemapStyle(this.basemapUrl, language, {
          relief,
          reliefSource: this.reliefKind,
          ways,
          imagery,
        });
        // MapLibre can only apply the difference to a style that is done loading; asked too early it
        // logs "Unable to perform style diff" and rebuilds everything. So it waits.
        const apply = () => {
          if (destroyed) return;
          if (map.isStyleLoaded()) map.setStyle(style);
          else map.once('styledata', apply);
        };
        apply();
      }
      styled = wanted;
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

  /**
   * The view of the map when it is created, unless a parent already gave it one: where the last
   * visit stopped, or all of France fitted to the screen (to the right of the side panel, or above
   * the sheet of a phone), for a first visit.
   */
  private chooseStartingView(): void {
    const given =
      this.center() !== DEFAULT_CENTER || this.zoom() !== DEFAULT_ZOOM;
    if (given) return;
    const stored = readStoredView();
    if (stored) {
      this.center.set(stored.center);
      this.zoom.set(stored.zoom);
      return;
    }
    const host = this.container().nativeElement;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const phone = width <= PHONE_WIDTH_PX;
    const view = viewToFit(FRANCE_BOX, width, height, {
      // The side panel takes the left of a wide screen, the closed sheet the foot of a phone.
      left: phone ? 0 : Math.min(PANEL_ROOM_PX, width / 3),
      top: phone ? PHONE_TOP_ROOM_PX : 0,
      bottom: phone ? PHONE_BOTTOM_ROOM_PX : 0,
      right: MAP_BUTTONS_ROOM_PX,
    });
    this.center.set(view.center);
    this.zoom.set(view.zoom);
  }

  protected resetNorth(): void {
    this.map()?.resetNorth();
  }

  /** Room left for the panel of layers under its top, so that it never runs out of the window. */
  protected readonly layersMaxHeight = signal<number | null>(null);

  protected toggleLayers(): void {
    this.layersOpen.update((open) => !open);
    this.measureLayers();
  }

  /** The panel takes the room down to the bottom of the window and scrolls inside when short. */
  private measureLayers(): void {
    if (!this.layersOpen()) return;
    queueMicrotask(() => {
      const box = this.host.nativeElement.querySelector('.map-layers');
      if (!box) return;
      const room = window.innerHeight - box.getBoundingClientRect().top - 12;
      this.layersMaxHeight.set(Math.max(room, 120));
    });
  }

  /** Escape closes the panel of layers and gives the focus back to its button. */
  protected closeLayers(): void {
    if (!this.layersOpen()) return;
    this.layersOpen.set(false);
    this.host.nativeElement
      .querySelector<HTMLElement>('.layers-button')
      ?.focus();
  }

  /** A click or a tap outside the panel closes it. */
  protected onOutside(event: Event): void {
    if (!this.layersOpen()) return;
    const target = event.target as Node | null;
    const inside = this.host.nativeElement
      .querySelector('.map-layers')
      ?.contains(target);
    if (!inside) this.layersOpen.set(false);
  }

  protected setImagery(event: Event): void {
    this.layers.setImagery((event.target as HTMLInputElement).checked);
  }

  protected setWays(event: Event): void {
    this.layers.setWays((event.target as HTMLInputElement).checked);
  }

  protected setRelief(event: Event): void {
    this.layers.setRelief((event.target as HTMLInputElement).checked);
  }
}
