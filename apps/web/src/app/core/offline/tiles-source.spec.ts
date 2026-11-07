import type { RangeResponse, Source } from 'pmtiles';
import { OfflineFirstSource, OfflineTilesReader } from './tiles-source';

describe('OfflineFirstSource', () => {
  const remoteBytes = new Uint8Array([9, 9, 9]).buffer;
  let remoteCalls: [number, number][];
  const remote: Source = {
    getKey: () => 'remote',
    getBytes: async (offset, length): Promise<RangeResponse> => {
      remoteCalls.push([offset, length]);
      return { data: remoteBytes };
    },
  };
  let local: ArrayBuffer | null;
  const reader: OfflineTilesReader = { read: async () => local };
  const source = new OfflineFirstSource('http://t/a.pmtiles', reader, remote);

  beforeEach(() => {
    remoteCalls = [];
    local = null;
  });

  it('is keyed by the archive URL, so the protocol finds it from the style', () => {
    expect(source.getKey()).toBe('http://t/a.pmtiles');
  });

  it('reads the downloaded copy without touching the network', async () => {
    local = new Uint8Array([1, 2]).buffer;
    const { data } = await source.getBytes(10, 2);
    expect(Array.from(new Uint8Array(data))).toEqual([1, 2]);
    expect(remoteCalls).toEqual([]);
  });

  it('falls back to range requests when nothing is downloaded', async () => {
    const { data } = await source.getBytes(10, 3);
    expect(data).toBe(remoteBytes);
    expect(remoteCalls).toEqual([[10, 3]]);
  });

  it('follows a download or a removal on the next read', async () => {
    await source.getBytes(0, 1);
    local = new Uint8Array([5]).buffer;
    await source.getBytes(0, 1);
    local = null;
    await source.getBytes(0, 1);
    expect(remoteCalls).toHaveLength(2);
  });
});
