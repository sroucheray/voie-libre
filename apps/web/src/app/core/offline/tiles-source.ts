import type { RangeResponse, Source } from 'pmtiles';

/** Reads bytes of the downloaded PMTiles archive; `null` when nothing is downloaded. */
export interface OfflineTilesReader {
  read(offset: number, length: number): Promise<ArrayBuffer | null>;
}

/**
 * A PMTiles source that reads the copy downloaded to the device when there is one, and falls back
 * to HTTP range requests otherwise. It decides on every read, so downloading or removing the copy
 * takes effect without recreating the map.
 */
export class OfflineFirstSource implements Source {
  constructor(
    private readonly url: string,
    private readonly offline: OfflineTilesReader,
    private readonly remote: Source,
  ) {}

  getKey(): string {
    return this.url;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const local = await this.offline.read(offset, length);
    if (local) return { data: local };
    return this.remote.getBytes(offset, length, signal, etag);
  }
}
