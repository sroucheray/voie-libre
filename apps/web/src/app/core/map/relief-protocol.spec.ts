// @vitest-environment node
// Node's Response and ArrayBuffer behave like the browser's; jsdom's do not.
import { FakeCacheStorage } from '../../../testing/fake-cache-storage';
import { reliefTileProtocol } from './relief-protocol';
import { publicReliefTileUrl } from './relief-source';

const abort = { signal: new AbortController().signal };

describe('reliefTileProtocol', () => {
  let storage: FakeCacheStorage;
  let fetched: string[];

  beforeEach(() => {
    storage = new FakeCacheStorage();
    fetched = [];
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array([1, 2, 3]));
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('builds the public tile URL from the protocol URL', () => {
    expect(publicReliefTileUrl(11, 1043, 729)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/1043/729.png',
    );
  });

  it('reads the tile from the public server when none is kept', async () => {
    const { data } = await reliefTileProtocol(
      { url: 'vlterrain://11/1043/729' },
      abort,
    );
    expect(fetched).toEqual([publicReliefTileUrl(11, 1043, 729)]);
    expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]);
  });

  it('reads a tile kept in an offline area before the network', async () => {
    const cache = await storage.open('voie-libre-area-v2-abc');
    await cache.put(
      publicReliefTileUrl(11, 1043, 729),
      new Response(new Uint8Array([9, 9])),
    );
    const { data } = await reliefTileProtocol(
      { url: 'vlterrain://11/1043/729' },
      abort,
    );
    expect(fetched).toEqual([]);
    expect(Array.from(new Uint8Array(data))).toEqual([9, 9]);
  });

  it('raises an error for a tile the server does not have, and for a URL that is not a tile', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
    await expect(
      reliefTileProtocol({ url: 'vlterrain://11/1/1' }, abort),
    ).rejects.toThrow('HTTP 404');
    await expect(
      reliefTileProtocol({ url: 'vlterrain://nope' }, abort),
    ).rejects.toThrow('Not a relief tile');
  });

  it('reads from the network when Cache Storage is missing', async () => {
    vi.stubGlobal('caches', undefined);
    const { data } = await reliefTileProtocol(
      { url: 'vlterrain://5/16/11' },
      abort,
    );
    expect(data.byteLength).toBe(3);
  });
});
