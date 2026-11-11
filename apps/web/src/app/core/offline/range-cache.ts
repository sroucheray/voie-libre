import type { RangeResponse, Source } from 'pmtiles';

/** Prefix of the Cache Storage caches that each hold one kept area. */
export const AREA_CACHE_PREFIX = 'voie-libre-area-v2-';

/**
 * The key of a byte range of an archive in Cache Storage: a made-up URL, never fetched. The map
 * and the downloader ask the archive for exactly the same ranges (header, directories, tiles), so
 * a range kept by one is found by the other.
 */
export const rangeUrl = (archiveUrl: string, offset: number, length: number) =>
  `${archiveUrl}?vl-range=${offset}-${length}`;

/**
 * Reads a range kept on the device, in any area. `caches.match` looks through every cache, so the
 * areas need no index: removing an area is deleting its cache.
 */
export async function readKeptRange(
  caches: CacheStorage,
  archiveUrl: string,
  offset: number,
  length: number,
): Promise<ArrayBuffer | null> {
  const response = await caches.match(rangeUrl(archiveUrl, offset, length));
  return response ? response.arrayBuffer() : null;
}

/**
 * A PMTiles source that fetches from the network and hands every range it got to `onRange`, which
 * keeps it. Reading the tiles of an area through it fills the cache of that area.
 */
export class RecordingSource implements Source {
  constructor(
    private readonly remote: Source,
    private readonly onRange: (
      offset: number,
      length: number,
      data: ArrayBuffer,
    ) => Promise<void>,
  ) {}

  getKey(): string {
    return this.remote.getKey();
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const response = await this.remote.getBytes(offset, length, signal, etag);
    await this.onRange(offset, length, response.data);
    return response;
  }
}
