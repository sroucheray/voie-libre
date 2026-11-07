import { Injectable, computed, inject, signal } from '@angular/core';
import { basemapTilesUrl, buildBasemapStyle } from '../map/basemap-style';
import { BASEMAP_URL } from '../map/map-factory';
import type { OfflineTilesReader } from './tiles-source';

/** Name of the Cache Storage cache holding the downloaded PMTiles archive. */
export const OFFLINE_CACHE_NAME = 'voie-libre-basemap-v1';

export type OfflineState =
  'checking' | 'none' | 'downloading' | 'ready' | 'error';

/** Why a download failed; the UI translates these under `offline.errors.*`. */
export type OfflineErrorCode = 'unsupported' | 'network' | 'quota' | 'unknown';

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
 * The basemap on the device. The user downloads the PMTiles archive of the region on request; it
 * is kept in Cache Storage and read by byte ranges (see {@link OfflineFirstSource}). The same
 * action fetches every glyph and sprite file, which the service worker keeps (`dataGroups` in
 * `ngsw-config.json`). The state is `ready` only once everything is in place.
 */
@Injectable({ providedIn: 'root' })
export class OfflineBasemap implements OfflineTilesReader {
  private readonly baseUrl = inject(BASEMAP_URL);
  private readonly tilesUrl = basemapTilesUrl(this.baseUrl);

  private readonly stateSignal = signal<OfflineState>('checking');
  private readonly progressSignal = signal(0);
  private readonly downloadedSignal = signal(0);
  private readonly totalSignal = signal(0);
  private readonly sizeSignal = signal(0);
  private readonly errorSignal = signal<OfflineErrorCode | null>(null);

  readonly state = this.stateSignal.asReadonly();
  /** 0 to 1 while downloading. */
  readonly progress = this.progressSignal.asReadonly();
  readonly downloadedBytes = this.downloadedSignal.asReadonly();
  /** Size announced by the server; 0 while unknown. */
  readonly totalBytes = this.totalSignal.asReadonly();
  /** Size of the archive on the device. */
  readonly sizeBytes = this.sizeSignal.asReadonly();
  readonly errorCode = this.errorSignal.asReadonly();
  readonly supported = computed(() => this.cacheStorage() !== undefined);

  private blobPromise: Promise<Blob | null> | null = null;
  private controller: AbortController | null = null;

  constructor() {
    void this.refresh();
  }

  /** Reads the cache again to learn whether an archive is already on the device. */
  async refresh(): Promise<void> {
    if (!this.cacheStorage()) {
      this.stateSignal.set('none');
      return;
    }
    try {
      const blob = await this.blob();
      this.sizeSignal.set(blob?.size ?? 0);
      this.stateSignal.set(blob ? 'ready' : 'none');
    } catch {
      this.stateSignal.set('none');
    }
  }

  async read(offset: number, length: number): Promise<ArrayBuffer | null> {
    let blob: Blob | null;
    try {
      blob = await this.blob();
    } catch {
      return null;
    }
    return blob ? blob.slice(offset, offset + length).arrayBuffer() : null;
  }

  /** Downloads the archive and the small files. Does nothing while a download is running. */
  async download(): Promise<void> {
    if (this.stateSignal() === 'downloading') return;
    const caches = this.cacheStorage();
    if (!caches) {
      this.fail('unsupported');
      return;
    }
    this.errorSignal.set(null);
    this.progressSignal.set(0);
    this.downloadedSignal.set(0);
    this.totalSignal.set(0);
    this.stateSignal.set('downloading');
    const controller = (this.controller = new AbortController());
    try {
      // Ask the browser not to evict the archive under storage pressure. Best effort.
      void navigator.storage?.persist?.().catch(() => undefined);
      await this.waitForServiceWorker();
      await this.fetchAssets(controller.signal);
      const archive = await this.fetchArchive(controller.signal);
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      await cache.put(
        this.tilesUrl,
        new Response(archive, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(archive.size),
          },
        }),
      );
      this.blobPromise = Promise.resolve(archive);
      this.sizeSignal.set(archive.size);
      this.progressSignal.set(1);
      this.stateSignal.set('ready');
    } catch (error) {
      if (controller.signal.aborted) {
        this.stateSignal.set(this.sizeSignal() > 0 ? 'ready' : 'none');
      } else {
        console.error('Downloading the basemap failed', error);
        this.fail(this.codeOf(error));
      }
    } finally {
      this.controller = null;
    }
  }

  /** Stops a running download; nothing partial is kept. */
  cancel(): void {
    this.controller?.abort();
  }

  /**
   * Deletes the downloaded archive. The glyphs and sprites stay in the service worker cache
   * (about 14 MB the browser may evict): they are shared with the online map.
   */
  async remove(): Promise<void> {
    const caches = this.cacheStorage();
    if (!caches) return;
    try {
      await caches.delete(OFFLINE_CACHE_NAME);
    } catch {
      // Nothing more to do: the next refresh shows the real state.
    }
    this.blobPromise = null;
    this.sizeSignal.set(0);
    this.errorSignal.set(null);
    this.stateSignal.set('none');
  }

  private blob(): Promise<Blob | null> {
    this.blobPromise ??= this.loadBlob().catch((error: unknown) => {
      this.blobPromise = null;
      throw error;
    });
    return this.blobPromise;
  }

  private async loadBlob(): Promise<Blob | null> {
    const caches = this.cacheStorage();
    if (!caches || !(await caches.has(OFFLINE_CACHE_NAME))) return null;
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const response = await cache.match(this.tilesUrl);
    return response ? response.blob() : null;
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

  private async fetchArchive(signal: AbortSignal): Promise<Blob> {
    const response = await fetch(this.tilesUrl, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`${this.tilesUrl}: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get('content-length')) || 0;
    this.totalSignal.set(total);
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array<ArrayBuffer>);
      received += value.byteLength;
      this.downloadedSignal.set(received);
      if (total > 0) {
        this.progressSignal.set(
          ASSETS_SHARE + (received / total) * (1 - ASSETS_SHARE),
        );
      }
    }
    return new Blob(chunks, { type: 'application/octet-stream' });
  }

  private fail(code: OfflineErrorCode): void {
    this.errorSignal.set(code);
    this.stateSignal.set(this.sizeSignal() > 0 ? 'ready' : 'error');
    if (this.sizeSignal() > 0) return;
    this.progressSignal.set(0);
  }

  private codeOf(error: unknown): OfflineErrorCode {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'QuotaExceededError') return 'quota';
    if (error instanceof TypeError) return 'network';
    return 'unknown';
  }

  private cacheStorage(): CacheStorage | undefined {
    return globalThis.caches;
  }
}
