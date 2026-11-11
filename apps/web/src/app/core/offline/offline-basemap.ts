import { Injectable, computed, inject, signal } from '@angular/core';
import { RELIEF_MAX_ZOOM, RELIEF_MIN_ZOOM } from '@voie-libre/shared';
import {
  basemapTilesUrl,
  buildBasemapStyle,
  reliefTilesUrl,
} from '../map/basemap-style';
import { BASEMAP_URL, type LngLat } from '../map/map-factory';
import {
  PUBLIC_RELIEF_OFFLINE_MAX_ZOOM,
  PUBLIC_RELIEF_OFFLINE_MIN_ZOOM,
  RELIEF_SOURCE_KIND,
  publicReliefTileUrl,
} from '../map/relief-source';
import {
  OFFLINE_MAX_ZOOM,
  boxAround,
  boxTiles,
  corridorTiles,
  countBoxTiles,
  type Box,
  type TileId,
} from './area-tiles';
import {
  AREA_CACHE_PREFIX,
  RecordingSource,
  readKeptRange,
  rangeUrl,
} from './range-cache';
import type { OfflineTilesReader } from './tiles-source';

/** The cache of the first version, which held the whole archive: deleted when found. */
export const OFFLINE_CACHE_NAME = 'voie-libre-basemap-v1';

/** Where the list of kept areas is remembered (only a list: the tiles are in Cache Storage). */
export const AREAS_KEY = 'voie-libre.offline-areas';

/** Width of the corridor kept around a route, on each side. */
export const AREA_BUFFER_METERS = 5000;
/** The largest area that can be kept: above this the user is asked for a smaller one. */
export const AREA_MAX_BYTES = 1_000_000_000;
/** The most tiles an area may list, so that a view of a whole country is refused without a pass. */
export const AREA_MAX_TILES = 150_000;
/** Tiles fetched to estimate the size of an area. */
const SAMPLE_TILES = 24;
/** Public terrain tiles fetched to estimate their size: they weigh about the same, zoom after zoom. */
const SAMPLE_PUBLIC_TILES = 8;

export type OfflineState = 'checking' | 'idle' | 'planning' | 'downloading';

/** Why an area was refused or failed; the UI translates these under `offline.errors.*`. */
export type OfflineErrorCode =
  'unsupported' | 'network' | 'quota' | 'too_big' | 'unknown';

/** What the user asks to keep: the rectangle on screen, or the corridor around a route. */
export type AreaShape =
  { kind: 'view'; box: Box } | { kind: 'route'; line: readonly LngLat[] };

/** What keeping a shape would take, shown before the user agrees. */
export interface AreaPlan {
  shape: AreaShape;
  /** Tiles of the basemap, from zoom 0 to 14. */
  tiles: TileId[];
  /** Tiles of the relief that the server has for the same area (empty without relief). */
  reliefTiles: TileId[];
  /** Estimated bytes, from a sample of the tiles. */
  bytes: number;
  /** The device has room for it. */
  fits: boolean;
}

/** An area kept on the device. */
export interface OfflineArea {
  id: string;
  name: string;
  kind: AreaShape['kind'];
  box: Box;
  tiles: number;
  bytes: number;
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** The relief of the area is kept too. */
  relief: boolean;
}

/** Glyph ranges are 256 code points each, up to U+FFFF. */
const GLYPH_RANGES = Array.from(
  { length: 256 },
  (_, i) => `${i * 256}-${i * 256 + 255}`,
);
/** Parallel requests when fetching the small files (glyphs, sprites). */
const CONCURRENCY = 8;
/** Share of the progress bar given to the small files; the archive gets the rest. */
const ASSETS_SHARE = 0.05;

/**
 * Font names in a `text-font` value: a plain list of names at the top level, or the `literal`
 * lists inside an expression such as
 * `["case", cond, ["literal", ["Noto Sans Medium"]], ["literal", ["Noto Sans Regular"]]]`.
 * Other string arrays in an expression (`["get", "min_zoom"]`) are not fonts.
 */
function collectFonts(value: unknown, into: Set<string>, top = true): void {
  if (!Array.isArray(value)) return;
  if (value[0] === 'literal') {
    if (Array.isArray(value[1])) {
      for (const name of value[1]) if (typeof name === 'string') into.add(name);
    }
    return;
  }
  if (top && value.every((item) => typeof item === 'string')) {
    for (const name of value) into.add(name as string);
    return;
  }
  for (const item of value) collectFonts(item, into, false);
}

/** The font names the style asks for, read from the style itself so they cannot drift apart. */
export function basemapFonts(baseUrl: string): string[] {
  const fonts = new Set<string>();
  for (const layer of buildBasemapStyle(baseUrl, 'en').layers) {
    const font = (layer as { layout?: { 'text-font'?: unknown } }).layout?.[
      'text-font'
    ];
    collectFonts(font, fonts);
  }
  return [...fonts].sort();
}

/** Every glyph range of every font, and the sprite files: what the style loads besides tiles. */
export function basemapAssetUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const glyphs = basemapFonts(baseUrl).flatMap((font) =>
    GLYPH_RANGES.map(
      (range) => `${base}/fonts/${encodeURIComponent(font)}/${range}.pbf`,
    ),
  );
  const sprites = ['', '@2x'].flatMap((density) => [
    `${base}/sprites/v4/light${density}.json`,
    `${base}/sprites/v4/light${density}.png`,
  ]);
  return [...glyphs, ...sprites];
}

/**
 * The basemap on the device, by area. The archive is far too big to copy, so the user keeps the
 * places they need: the corridor around a route, or the view on screen. Keeping an area reads all
 * its tiles from the archive through a {@link RecordingSource}, which stores every byte range it
 * got in a Cache Storage cache of its own (one cache per area, so removing it is deleting the
 * cache). The map reads those ranges before the network (see {@link OfflineFirstSource}). The same
 * action fetches every glyph and sprite file, which the service worker keeps (`dataGroups` in
 * `ngsw-config.json`), and the relief tiles of the area when the server has a relief archive.
 */
@Injectable({ providedIn: 'root' })
export class OfflineBasemap implements OfflineTilesReader {
  private readonly baseUrl = inject(BASEMAP_URL);
  private readonly tilesUrl = basemapTilesUrl(this.baseUrl);
  /** The hillshade's elevation tiles: optional, a server may not have them. */
  private readonly reliefUrl = reliefTilesUrl(this.baseUrl);
  /** Where the hillshade's elevations come from: the public tiles, or our own archive. */
  private readonly reliefKind = inject(RELIEF_SOURCE_KIND);

  private readonly stateSignal = signal<OfflineState>('checking');
  private readonly progressSignal = signal(0);
  private readonly downloadedSignal = signal(0);
  private readonly totalSignal = signal(0);
  private readonly errorSignal = signal<OfflineErrorCode | null>(null);
  private readonly areasSignal = signal<OfflineArea[]>([]);
  private readonly planSignal = signal<AreaPlan | null>(null);

  readonly state = this.stateSignal.asReadonly();
  /** 0 to 1 while downloading. */
  readonly progress = this.progressSignal.asReadonly();
  readonly downloadedBytes = this.downloadedSignal.asReadonly();
  /** Estimated size of the area being downloaded. */
  readonly totalBytes = this.totalSignal.asReadonly();
  readonly errorCode = this.errorSignal.asReadonly();
  /** The areas kept on the device, the newest first. */
  readonly areas = this.areasSignal.asReadonly();
  /** The area the user is asked to confirm, once {@link plan} has estimated it. */
  readonly pending = this.planSignal.asReadonly();
  /** Bytes of all the kept areas (an overlap is counted twice). */
  readonly sizeBytes = computed(() =>
    this.areasSignal().reduce((sum, area) => sum + area.bytes, 0),
  );
  readonly supported = computed(() => this.cacheStorage() !== undefined);

  private controller: AbortController | null = null;

  constructor() {
    void this.refresh();
  }

  /** Reads which areas are on the device: the list, checked against the caches that exist. */
  async refresh(): Promise<void> {
    const caches = this.cacheStorage();
    if (!caches) {
      this.stateSignal.set('idle');
      return;
    }
    try {
      // The first version kept the whole archive in one cache: it is of no use any more.
      await caches.delete(OFFLINE_CACHE_NAME);
      const stored = this.readAreas();
      const kept: OfflineArea[] = [];
      for (const area of stored) {
        if (await caches.has(this.cacheName(area.id))) kept.push(area);
      }
      if (kept.length !== stored.length) this.writeAreas(kept);
      this.areasSignal.set(kept);
    } catch {
      // The list stays as it was: the next refresh shows the real state.
    }
    if (this.stateSignal() === 'checking') this.stateSignal.set('idle');
  }

  /** Reads a range of the basemap's archive kept on the device. */
  read(offset: number, length: number): Promise<ArrayBuffer | null> {
    return this.readFrom(this.tilesUrl, offset, length);
  }

  /** A reader of the ranges kept for the archive at `url` (the basemap's or the relief's). */
  readerFor(url: string): OfflineTilesReader {
    return { read: (offset, length) => this.readFrom(url, offset, length) };
  }

  /** True when an area on the device holds the archive at `url` (the relief's only if kept). */
  async has(url: string): Promise<boolean> {
    if (url === this.reliefUrl) return this.areasSignal().some((a) => a.relief);
    return this.areasSignal().length > 0;
  }

  private async readFrom(
    url: string,
    offset: number,
    length: number,
  ): Promise<ArrayBuffer | null> {
    const caches = this.cacheStorage();
    if (!caches || this.areasSignal().length === 0) return null;
    try {
      return await readKeptRange(caches, url, offset, length);
    } catch {
      return null;
    }
  }

  /**
   * Works out what keeping `shape` would take: the tiles, an estimate of the bytes from a sample
   * of them, and whether the device has room. The result waits in {@link pending} for the user's
   * yes ({@link keep}) or no ({@link discard}). An area above {@link AREA_MAX_BYTES} is refused.
   */
  async plan(shape: AreaShape): Promise<void> {
    if (
      this.stateSignal() === 'planning' ||
      this.stateSignal() === 'downloading'
    ) {
      return;
    }
    if (!this.cacheStorage()) {
      this.fail('unsupported');
      return;
    }
    this.errorSignal.set(null);
    this.planSignal.set(null);
    this.stateSignal.set('planning');
    const controller = (this.controller = new AbortController());
    try {
      const tiles = this.tilesOf(shape, 0, OFFLINE_MAX_ZOOM);
      if (!tiles) {
        this.fail('too_big');
        return;
      }
      const wanted =
        this.reliefKind === 'public'
          ? (this.tilesOf(
              shape,
              PUBLIC_RELIEF_OFFLINE_MIN_ZOOM,
              PUBLIC_RELIEF_OFFLINE_MAX_ZOOM,
            ) ?? [])
          : (this.tilesOf(shape, RELIEF_MIN_ZOOM, RELIEF_MAX_ZOOM) ?? []);
      // A server without a relief archive answers 404: the area has no relief, and that is fine.
      const relief = await (
        this.reliefKind === 'public'
          ? this.estimatePublicRelief(wanted, controller.signal)
          : this.estimate(this.reliefUrl, wanted, controller.signal, 0)
      ).catch((error: unknown) => {
        if (controller.signal.aborted) throw error;
        return null;
      });
      const reliefTiles = relief === null ? [] : wanted;
      const basemap = await this.estimate(
        this.tilesUrl,
        tiles,
        controller.signal,
      );
      const bytes = basemap + (relief ?? 0);
      if (controller.signal.aborted) return;
      if (bytes > AREA_MAX_BYTES) {
        this.fail('too_big');
        return;
      }
      const fits = await this.hasRoomFor(bytes);
      this.planSignal.set({ shape, tiles, reliefTiles, bytes, fits });
      this.stateSignal.set('idle');
    } catch (error) {
      if (controller.signal.aborted) {
        this.stateSignal.set('idle');
      } else {
        console.error('Estimating the area failed', error);
        this.fail(this.codeOf(error));
      }
    } finally {
      this.controller = null;
    }
  }

  /** The user said no to the area waiting in {@link pending}. */
  discard(): void {
    this.planSignal.set(null);
    this.errorSignal.set(null);
  }

  /**
   * Keeps the area of `plan` under `name`: the small files first, then every tile of the area
   * (the relief's too), all of them stored. Does nothing while another run is going. A failure or
   * a cancel leaves nothing of the area behind.
   */
  async keep(name: string): Promise<void> {
    const plan = this.planSignal();
    const caches = this.cacheStorage();
    if (!plan || !caches || this.stateSignal() === 'downloading') return;
    if (!plan.fits) {
      this.fail('quota');
      return;
    }
    this.errorSignal.set(null);
    this.progressSignal.set(0);
    this.downloadedSignal.set(0);
    this.totalSignal.set(plan.bytes);
    this.stateSignal.set('downloading');
    const controller = (this.controller = new AbortController());
    const id = this.newId();
    const cacheName = this.cacheName(id);
    try {
      // Ask the browser not to evict the tiles under storage pressure. Best effort.
      void navigator.storage?.persist?.().catch(() => undefined);
      if (this.areasSignal().length === 0) {
        await this.waitForServiceWorker();
        await this.fetchAssets(controller.signal);
      }
      const cache = await caches.open(cacheName);
      const { PMTiles, FetchSource } = await this.pmtiles();
      const record = (url: string) =>
        new PMTiles(
          new RecordingSource(
            new FetchSource(url),
            async (offset, length, data) => {
              await cache.put(
                rangeUrl(url, offset, length),
                new Response(data.slice(0)),
              );
              this.downloadedSignal.update((n) => n + data.byteLength);
            },
          ),
        );
      const basemap = record(this.tilesUrl);
      const publicRelief = this.reliefKind === 'public';
      const relief = record(this.reliefUrl);
      // A server without a relief archive answers 404 for its header: the map works without. The
      // public tiles need no probe: the plan already read some.
      const hasRelief =
        plan.reliefTiles.length > 0 &&
        (publicRelief ||
          (await relief.getHeader().then(
            () => true,
            () => false,
          )));
      const read = async (archive: InstanceType<typeof PMTiles>, t: TileId) => {
        await archive.getZxy(t.z, t.x, t.y, controller.signal);
      };
      const jobs: (() => Promise<void>)[] = [
        ...plan.tiles.map((t) => () => read(basemap, t)),
        ...(hasRelief
          ? plan.reliefTiles.map((t) =>
              publicRelief
                ? () => this.keepPublicTile(cache, t, controller.signal)
                : () => read(relief, t),
            )
          : []),
      ];
      let done = 0;
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          await jobs[next++]();
          done++;
          this.progressSignal.set(
            ASSETS_SHARE + (done / jobs.length) * (1 - ASSETS_SHARE),
          );
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      const area: OfflineArea = {
        id,
        name,
        kind: plan.shape.kind,
        box: this.boxOf(plan.shape),
        tiles: jobs.length,
        bytes: this.downloadedSignal(),
        createdAt: Date.now(),
        relief: hasRelief,
      };
      const areas = [area, ...this.areasSignal()];
      this.areasSignal.set(areas);
      this.writeAreas(areas);
      this.planSignal.set(null);
      this.progressSignal.set(1);
      this.stateSignal.set('idle');
    } catch (error) {
      await caches.delete(cacheName).catch(() => false);
      if (controller.signal.aborted) {
        this.stateSignal.set('idle');
      } else {
        console.error('Keeping the area failed', error);
        this.fail(this.codeOf(error));
      }
    } finally {
      this.controller = null;
    }
  }

  /** Stops a running estimate or download; nothing partial is kept. */
  cancel(): void {
    this.controller?.abort();
  }

  /**
   * Removes an area and frees its space. The glyphs and sprites stay in the service worker cache
   * (about 14 MB the browser may evict): they are shared with the online map.
   */
  async removeArea(id: string): Promise<void> {
    const caches = this.cacheStorage();
    try {
      await caches?.delete(this.cacheName(id));
    } catch {
      // The list below is what the user sees; the next refresh checks the caches again.
    }
    const areas = this.areasSignal().filter((area) => area.id !== id);
    this.areasSignal.set(areas);
    this.writeAreas(areas);
    this.errorSignal.set(null);
  }

  /** The tiles of a shape between two zooms; `null` when the shape lists too many to be kept. */
  private tilesOf(
    shape: AreaShape,
    minZoom: number,
    maxZoom: number,
  ): TileId[] | null {
    if (shape.kind === 'view') {
      if (countBoxTiles(shape.box, minZoom, maxZoom) > AREA_MAX_TILES)
        return null;
      return boxTiles(shape.box, minZoom, maxZoom);
    }
    // A corridor lists at most the tiles of its box: refuse before building a huge list.
    const box = boxAround(shape.line, AREA_BUFFER_METERS);
    if (countBoxTiles(box, maxZoom, maxZoom) > AREA_MAX_TILES) return null;
    const tiles = corridorTiles(
      shape.line,
      AREA_BUFFER_METERS,
      minZoom,
      maxZoom,
    );
    return tiles.length > AREA_MAX_TILES ? null : tiles;
  }

  private boxOf(shape: AreaShape): Box {
    return shape.kind === 'view'
      ? shape.box
      : boxAround(shape.line, AREA_BUFFER_METERS);
  }

  /**
   * Bytes the tiles of an archive will take, from the bytes of a sample of its tiles from zoom
   * `deepFrom` on (the shallow ones are few). Throws when the archive cannot be read.
   */
  private async estimate(
    url: string,
    tiles: TileId[],
    signal: AbortSignal,
    deepFrom = 10,
  ): Promise<number> {
    const deep = tiles.filter((tile) => tile.z >= deepFrom);
    const pool = deep.length > 0 ? deep : tiles;
    if (pool.length === 0) return 0;
    const stride = Math.max(1, Math.floor(pool.length / SAMPLE_TILES));
    const sample = pool
      .filter((_, i) => i % stride === 0)
      .slice(0, SAMPLE_TILES);
    const { PMTiles, FetchSource } = await this.pmtiles();
    let bytes = 0;
    const archive = new PMTiles(
      new RecordingSource(new FetchSource(url), async (_offset, length) => {
        bytes += length;
      }),
    );
    for (const tile of sample)
      await archive.getZxy(tile.z, tile.x, tile.y, signal);
    return Math.round((bytes / sample.length) * tiles.length);
  }

  /** Reads a public terrain tile and keeps it in the area's cache, under its public URL. */
  private async keepPublicTile(
    cache: Cache,
    tile: TileId,
    signal: AbortSignal,
  ): Promise<void> {
    const url = publicReliefTileUrl(tile.z, tile.x, tile.y);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    await cache.put(
      url,
      new Response(data.slice(0), { headers: { 'content-type': 'image/png' } }),
    );
    this.downloadedSignal.update((n) => n + data.byteLength);
  }

  /** Bytes the public terrain tiles of an area will take, from a sample of them. Throws if unreadable. */
  private async estimatePublicRelief(
    tiles: TileId[],
    signal: AbortSignal,
  ): Promise<number> {
    if (tiles.length === 0) return 0;
    const stride = Math.max(1, Math.floor(tiles.length / SAMPLE_PUBLIC_TILES));
    const sample = tiles
      .filter((_, i) => i % stride === 0)
      .slice(0, SAMPLE_PUBLIC_TILES);
    let bytes = 0;
    for (const t of sample) {
      const response = await fetch(publicReliefTileUrl(t.z, t.x, t.y), {
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes += (await response.arrayBuffer()).byteLength;
    }
    return Math.round((bytes / sample.length) * tiles.length);
  }

  /** PMTiles is large and loaded on demand; tests replace this to read a fake archive. */
  protected pmtiles(): Promise<typeof import('pmtiles')> {
    return import('pmtiles');
  }

  /** Room left on the device for `bytes`, with a margin; unknown counts as room. */
  private async hasRoomFor(bytes: number): Promise<boolean> {
    try {
      const { quota, usage } = (await navigator.storage?.estimate?.()) ?? {};
      if (quota === undefined || usage === undefined) return true;
      return quota - usage > bytes * 1.2;
    } catch {
      return true;
    }
  }

  /**
   * On a first visit the service worker may not control the page yet; the glyphs and sprites are
   * only kept if it does. Wait briefly for it. Without a registration (development) go on.
   */
  private async waitForServiceWorker(): Promise<void> {
    const worker = navigator.serviceWorker as
      ServiceWorkerContainer | undefined;
    if (!worker || worker.controller) return;
    if (!(await worker.getRegistration())) return;
    await Promise.race([
      worker.ready,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  /** Small files first: a failure there costs little time. Each fetch goes through the service worker. */
  private async fetchAssets(signal: AbortSignal): Promise<void> {
    const urls = basemapAssetUrls(this.baseUrl);
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < urls.length) {
        const url = urls[next++];
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        // Drain the body so the service worker finishes caching the response.
        await response.arrayBuffer();
        done++;
        this.progressSignal.set((done / urls.length) * ASSETS_SHARE);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  private fail(code: OfflineErrorCode): void {
    this.errorSignal.set(code);
    this.progressSignal.set(0);
    this.stateSignal.set('idle');
  }

  private codeOf(error: unknown): OfflineErrorCode {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'QuotaExceededError') return 'quota';
    if (error instanceof TypeError) return 'network';
    return 'unknown';
  }

  private cacheName(id: string): string {
    return `${AREA_CACHE_PREFIX}${id}`;
  }

  private newId(): string {
    return Math.random().toString(36).slice(2, 12);
  }

  private readAreas(): OfflineArea[] {
    try {
      const stored = JSON.parse(localStorage.getItem(AREAS_KEY) ?? '[]');
      return Array.isArray(stored) ? (stored as OfflineArea[]) : [];
    } catch {
      return [];
    }
  }

  private writeAreas(areas: OfflineArea[]): void {
    try {
      localStorage.setItem(AREAS_KEY, JSON.stringify(areas));
    } catch {
      // Storage refused: the list holds until the page is closed.
    }
  }

  private cacheStorage(): CacheStorage | undefined {
    return globalThis.caches;
  }
}
