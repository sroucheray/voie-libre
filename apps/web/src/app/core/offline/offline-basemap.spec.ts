// @vitest-environment node
// Node's Blob, Response and streams behave like the browser's; jsdom's Blob does not (no
// arrayBuffer(), binary chunks turned into text).
import { Injector } from '@angular/core';
import { FakeCacheStorage } from '../../../testing/fake-cache-storage';
import { BASEMAP_URL } from '../map/map-factory';
import {
  AREAS_KEY,
  AREA_MAX_BYTES,
  OFFLINE_CACHE_NAME,
  OfflineBasemap,
  basemapAssetUrls,
  basemapFonts,
  type AreaShape,
} from './offline-basemap';
import { AREA_CACHE_PREFIX } from './range-cache';

const BASE = 'http://tiles.test:8081';

describe('basemapFonts and basemapAssetUrls', () => {
  it('finds the fonts of the style, including those inside expressions', () => {
    expect(basemapFonts(BASE)).toEqual([
      'Noto Sans Italic',
      'Noto Sans Medium',
      'Noto Sans Regular',
    ]);
  });

  it('lists 256 glyph ranges per font and the four sprite files, all on the basemap host', () => {
    const urls = basemapAssetUrls(`${BASE}/`);
    expect(urls).toHaveLength(3 * 256 + 4);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => url.startsWith(`${BASE}/`))).toBe(true);
    expect(urls).toContain(`${BASE}/fonts/Noto%20Sans%20Regular/0-255.pbf`);
    expect(urls).toContain(
      `${BASE}/fonts/Noto%20Sans%20Regular/65280-65535.pbf`,
    );
    expect(urls).toContain(`${BASE}/sprites/v4/light@2x.png`);
  });
});

/** A box of a few hundred tiles around Clermont-Ferrand, zooms 0 to 14. */
const VIEW: AreaShape = { kind: 'view', box: [3.05, 45.76, 3.14, 45.82] };

/**
 * A stand-in for the `pmtiles` module: the "archive" answers any range with that many bytes, and
 * `getZxy` reads one range per tile, the way the real reader does. Tests choose which tiles cost
 * what and whether the relief archive exists.
 */
function fakePmtiles(options: {
  tileBytes: () => number;
  hasRelief: () => boolean;
  failWith: () => Error | null;
  onRead: (url: string) => void;
}) {
  class FetchSource {
    constructor(private readonly url: string) {}
    getKey() {
      return this.url;
    }
    async getBytes(offset: number, length: number) {
      options.onRead(this.url);
      const failure = options.failWith();
      if (failure) throw failure;
      if (this.url.endsWith('/relief.pmtiles') && !options.hasRelief()) {
        throw new Error('HTTP 404');
      }
      return { data: new Uint8Array(length).buffer };
    }
  }
  class PMTiles {
    constructor(
      private readonly source: {
        getBytes(o: number, l: number, s?: AbortSignal): Promise<unknown>;
      },
    ) {}
    async getHeader() {
      await this.source.getBytes(0, 16384);
      return {};
    }
    async getZxy(z: number, x: number, y: number, signal?: AbortSignal) {
      // The real reader gives up when the signal says so.
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      await this.source.getBytes(
        z * 10_000_000 + x * 1000 + y,
        options.tileBytes(),
        signal,
      );
      return { data: new ArrayBuffer(0) };
    }
  }
  return { PMTiles, FetchSource } as unknown as typeof import('pmtiles');
}

describe('OfflineBasemap', () => {
  let storage: FakeCacheStorage;
  let fetched: string[];
  let reads: string[];
  let stored: Map<string, string>;
  let tileBytes: number;
  let hasRelief: boolean;
  let failWith: Error | null;
  let estimate: { quota: number; usage: number } | undefined;

  beforeEach(() => {
    storage = new FakeCacheStorage();
    fetched = [];
    reads = [];
    stored = new Map();
    tileBytes = 1000;
    hasRelief = true;
    failWith = null;
    estimate = undefined;
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    });
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array(10));
    });
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => estimate },
    });
    vi.spyOn(
      OfflineBasemap.prototype as unknown as {
        pmtiles(): Promise<unknown>;
      },
      'pmtiles',
    ).mockImplementation(async () =>
      fakePmtiles({
        tileBytes: () => tileBytes,
        hasRelief: () => hasRelief,
        failWith: () => failWith,
        onRead: (url) => reads.push(url),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A fresh service, like the one a page load creates. */
  async function create() {
    const offline = Injector.create({
      providers: [OfflineBasemap, { provide: BASEMAP_URL, useValue: BASE }],
    }).get(OfflineBasemap);
    await offline.refresh();
    return offline;
  }

  it('starts with no area and reads nothing', async () => {
    const offline = await create();
    expect(offline.state()).toBe('idle');
    expect(offline.areas()).toEqual([]);
    expect(await offline.read(0, 10)).toBeNull();
    expect(await offline.has(`${BASE}/clermont.pmtiles`)).toBe(false);
  });

  it('deletes the cache of the first version, which held the whole archive', async () => {
    await storage.open(OFFLINE_CACHE_NAME);
    await create();
    expect(storage.caches.has(OFFLINE_CACHE_NAME)).toBe(false);
  });

  it('estimates an area from a sample of its tiles, and waits for the answer', async () => {
    tileBytes = 2000;
    const offline = await create();
    await offline.plan(VIEW);
    const plan = offline.pending()!;
    expect(plan.tiles.length).toBeGreaterThan(40);
    expect(plan.reliefTiles.length).toBeGreaterThan(0);
    // 2000 bytes a tile, give or take the one read of the header and the root directory.
    // The relief tiles of the area count too, at the same price in this test.
    const all = plan.tiles.length + plan.reliefTiles.length;
    expect(plan.bytes).toBeGreaterThan(all * 2000 * 0.9);
    expect(plan.bytes).toBeLessThan(all * 2000 * 1.5);
    expect(plan.fits).toBe(true);
    // Only a sample was read: nothing is kept yet.
    expect(reads.length).toBeLessThan(60);
    expect(offline.areas()).toEqual([]);
    expect(offline.state()).toBe('idle');
    offline.discard();
    expect(offline.pending()).toBeNull();
  });

  it('refuses an area above the limit, with a code the UI translates', async () => {
    tileBytes = Math.ceil(AREA_MAX_BYTES / 20);
    const offline = await create();
    await offline.plan(VIEW);
    expect(offline.pending()).toBeNull();
    expect(offline.errorCode()).toBe('too_big');
  });

  it('refuses a view that lists far too many tiles without reading any', async () => {
    const offline = await create();
    await offline.plan({ kind: 'view', box: [-5, 41, 10, 51] });
    expect(offline.errorCode()).toBe('too_big');
    expect(reads).toEqual([]);
  });

  it('says when the device has no room for the area', async () => {
    estimate = { quota: 1_000_000, usage: 999_000 };
    const offline = await create();
    await offline.plan(VIEW);
    expect(offline.pending()?.fits).toBe(false);
    await offline.keep('Too big');
    expect(offline.errorCode()).toBe('quota');
    expect(offline.areas()).toEqual([]);
  });

  it('keeps an area: the glyphs, then every tile in a cache of its own, readable by range', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    const plan = offline.pending()!;
    await offline.keep('Clermont');

    expect(offline.state()).toBe('idle');
    expect(offline.progress()).toBe(1);
    expect(offline.pending()).toBeNull();
    const [area] = offline.areas();
    expect(area).toMatchObject({
      name: 'Clermont',
      kind: 'view',
      relief: true,
    });
    expect(area.tiles).toBe(plan.tiles.length + plan.reliefTiles.length);
    expect(area.bytes).toBeGreaterThan(plan.tiles.length * 1000);
    expect(offline.sizeBytes()).toBe(area.bytes);
    expect(fetched.filter((url) => url.endsWith('.pbf'))).toHaveLength(768);
    const cacheName = `${AREA_CACHE_PREFIX}${area.id}`;
    expect(storage.caches.has(cacheName)).toBe(true);
    // The list is kept for the next visit.
    expect(JSON.parse(stored.get(AREAS_KEY)!)).toHaveLength(1);

    // The map reads exactly the ranges that were kept.
    const tile = plan.tiles[plan.tiles.length - 1];
    const range = await offline.read(
      tile.z * 10_000_000 + tile.x * 1000 + tile.y,
      1000,
    );
    expect(range?.byteLength).toBe(1000);
    expect(await offline.read(123, 456)).toBeNull();
    expect(await offline.has(`${BASE}/relief.pmtiles`)).toBe(true);
  });

  it('keeps no relief when the server has none, which is not a failure', async () => {
    hasRelief = false;
    const offline = await create();
    await offline.plan(VIEW);
    const plan = offline.pending()!;
    await offline.keep('No relief');
    expect(offline.errorCode()).toBeNull();
    expect(offline.areas()[0].relief).toBe(false);
    expect(plan.reliefTiles).toEqual([]);
    expect(await offline.has(`${BASE}/relief.pmtiles`)).toBe(false);
    expect(await offline.has(`${BASE}/clermont.pmtiles`)).toBe(true);
  });

  it('keeps the corridor of a route, much smaller than its box', async () => {
    const offline = await create();
    const line: [number, number][] = [
      [3.0, 45.5],
      [3.4, 45.9],
    ];
    await offline.plan({ kind: 'route', line });
    const route = offline.pending()!.tiles.length;
    offline.discard();
    await offline.plan({
      kind: 'view',
      box: [3.0 - 0.07, 45.5 - 0.05, 3.4 + 0.07, 45.9 + 0.05],
    });
    expect(route).toBeLessThan(offline.pending()!.tiles.length);
  });

  it('fetches the glyphs and sprites only for the first area', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    await offline.keep('One');
    const first = fetched.length;
    expect(first).toBeGreaterThan(700);
    await offline.plan({ kind: 'view', box: [3.2, 45.7, 3.25, 45.73] });
    await offline.keep('Two');
    expect(fetched.length).toBe(first);
    expect(offline.areas().map((a) => a.name)).toEqual(['Two', 'One']);
  });

  it('removes an area and its space, and no longer reads its tiles', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    const tile = offline.pending()!.tiles[0];
    await offline.keep('Gone soon');
    const { id } = offline.areas()[0];
    const key = tile.z * 10_000_000 + tile.x * 1000 + tile.y;
    expect(await offline.read(key, 1000)).not.toBeNull();

    await offline.removeArea(id);
    expect(offline.areas()).toEqual([]);
    expect(offline.sizeBytes()).toBe(0);
    expect(storage.caches.has(`${AREA_CACHE_PREFIX}${id}`)).toBe(false);
    expect(await offline.read(key, 1000)).toBeNull();
    expect(JSON.parse(stored.get(AREAS_KEY)!)).toEqual([]);
  });

  it('forgets an area whose cache the browser evicted', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    await offline.keep('Evicted');
    const { id } = offline.areas()[0];
    storage.caches.delete(`${AREA_CACHE_PREFIX}${id}`);
    const again = await create();
    expect(again.areas()).toEqual([]);
  });

  it('reads the list of areas back on the next visit', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    await offline.keep('Back again');
    const again = await create();
    expect(again.areas().map((a) => a.name)).toEqual(['Back again']);
  });

  it('keeps nothing when the network fails, and says why', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    failWith = new TypeError('Failed to fetch');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await offline.keep('Failing');
    expect(offline.errorCode()).toBe('network');
    expect(offline.state()).toBe('idle');
    expect(offline.areas()).toEqual([]);
    expect(
      [...storage.caches.keys()].filter((n) => n.startsWith(AREA_CACHE_PREFIX)),
    ).toEqual([]);
  });

  it('reports a full storage as such, and keeps nothing', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    failWith = new DOMException('full', 'QuotaExceededError');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await offline.keep('Full');
    expect(offline.errorCode()).toBe('quota');
    expect(offline.areas()).toEqual([]);
  });

  it('keeps nothing when the download is cancelled', async () => {
    const offline = await create();
    await offline.plan(VIEW);
    const running = offline.keep('Cancelled');
    offline.cancel();
    await running;
    expect(offline.state()).toBe('idle');
    expect(offline.errorCode()).toBeNull();
    expect(offline.areas()).toEqual([]);
    expect(
      [...storage.caches.keys()].filter((n) => n.startsWith(AREA_CACHE_PREFIX)),
    ).toEqual([]);
  });

  it('does nothing without Cache Storage, and says so', async () => {
    vi.stubGlobal('caches', undefined);
    const offline = await create();
    expect(offline.supported()).toBe(false);
    await offline.plan(VIEW);
    expect(offline.errorCode()).toBe('unsupported');
  });
});
