// @vitest-environment node
// Node's Blob, Response and streams behave like the browser's; jsdom's Blob does not (no
// arrayBuffer(), binary chunks turned into text).
import { Injector } from '@angular/core';
import { FakeCacheStorage } from '../../../testing/fake-cache-storage';
import { BASEMAP_URL } from '../map/map-factory';
import {
  OFFLINE_CACHE_NAME,
  OfflineBasemap,
  basemapAssetUrls,
  basemapFonts,
} from './offline-basemap';

const BASE = 'http://tiles.test:8081';
const ARCHIVE = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);

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

describe('OfflineBasemap', () => {
  let storage: FakeCacheStorage;
  let fetched: string[];
  let failOn: ((url: string) => Response | Error | null) | null;

  beforeEach(() => {
    storage = new FakeCacheStorage();
    fetched = [];
    failOn = null;
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      const failure = failOn?.(url);
      if (failure instanceof Error) throw failure;
      if (failure) return failure;
      return url.endsWith('.pmtiles')
        ? new Response(ARCHIVE, {
            headers: { 'content-length': String(ARCHIVE.length) },
          })
        : new Response(new Uint8Array(10));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A fresh service, like the one a page load creates. */
  async function create() {
    const offline = Injector.create({
      providers: [OfflineBasemap, { provide: BASEMAP_URL, useValue: BASE }],
    }).get(OfflineBasemap);
    await offline.refresh();
    return offline;
  }

  it('starts empty and reads nothing', async () => {
    const offline = await create();
    expect(offline.state()).toBe('none');
    expect(await offline.read(0, 10)).toBeNull();
  });

  it('downloads the glyphs, the sprites and the archive, then serves byte ranges from it', async () => {
    const offline = await create();
    await offline.download();

    expect(offline.state()).toBe('ready');
    expect(offline.progress()).toBe(1);
    expect(offline.sizeBytes()).toBe(ARCHIVE.length);
    expect(offline.totalBytes()).toBe(ARCHIVE.length);
    expect(fetched.filter((url) => url.endsWith('.pbf'))).toHaveLength(768);
    expect(fetched.filter((url) => url.endsWith('.pmtiles'))).toEqual([
      `${BASE}/clermont.pmtiles`,
    ]);
    expect(storage.caches.get(OFFLINE_CACHE_NAME)?.entries.size).toBe(1);

    const slice = await offline.read(100, 16);
    expect(Array.from(new Uint8Array(slice!))).toEqual(
      Array.from(ARCHIVE.slice(100, 116)),
    );
  });

  it('finds the archive again after a reload', async () => {
    await (await create()).download();
    const reloaded = await create();
    expect(reloaded.state()).toBe('ready');
    expect(reloaded.sizeBytes()).toBe(ARCHIVE.length);
    expect((await reloaded.read(0, 4))!.byteLength).toBe(4);
  });

  it('removes the archive', async () => {
    const offline = await create();
    await offline.download();
    await offline.remove();
    expect(offline.state()).toBe('none');
    expect(offline.sizeBytes()).toBe(0);
    expect(await offline.read(0, 4)).toBeNull();
    expect(storage.caches.has(OFFLINE_CACHE_NAME)).toBe(false);
  });

  it('is not ready, and keeps nothing, when a glyph file is missing', async () => {
    failOn = (url) =>
      url.includes('Italic/256-511') ? new Response('', { status: 404 }) : null;
    const offline = await create();
    await offline.download();
    expect(offline.state()).toBe('error');
    expect(offline.errorCode()).toBe('unknown');
    expect(storage.caches.has(OFFLINE_CACHE_NAME)).toBe(false);
    expect(fetched.some((url) => url.endsWith('.pmtiles'))).toBe(false);
  });

  it('reports a network failure', async () => {
    failOn = () => new TypeError('Failed to fetch');
    const offline = await create();
    await offline.download();
    expect(offline.state()).toBe('error');
    expect(offline.errorCode()).toBe('network');
  });

  it('reports a full device', async () => {
    storage.putError = new DOMException('full', 'QuotaExceededError');
    const offline = await create();
    await offline.download();
    expect(offline.state()).toBe('error');
    expect(offline.errorCode()).toBe('quota');
    expect(await offline.read(0, 4)).toBeNull();
  });

  it('keeps an existing copy when a new download fails', async () => {
    const offline = await create();
    await offline.download();
    failOn = () => new TypeError('Failed to fetch');
    await offline.download();
    expect(offline.state()).toBe('ready');
    expect(offline.errorCode()).toBe('network');
    expect((await offline.read(0, 4))!.byteLength).toBe(4);
  });

  it('can be cancelled, leaving nothing behind', async () => {
    const offline = await create();
    vi.stubGlobal(
      'fetch',
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const download = offline.download();
    await Promise.resolve();
    expect(offline.state()).toBe('downloading');
    offline.cancel();
    await download;
    expect(offline.state()).toBe('none');
    expect(offline.errorCode()).toBeNull();
  });

  it('says so when the browser has no Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    const offline = await create();
    expect(offline.supported()).toBe(false);
    await offline.download();
    expect(offline.errorCode()).toBe('unsupported');
    expect(offline.state()).toBe('error');
  });
});
