import { Injectable, inject } from '@angular/core';
import type { LngLat } from '../core/map/map-factory';
import { tileAt, WAY_TILES, type Way } from '../core/map/way-tiles';
import { snapsToWays, snapToWay } from './snap-to-way';

/** Tiles of ways kept in memory: a session rarely looks at more places than that at once. */
const CACHE_SIZE = 64;

/**
 * Puts the points placed on the map on a way, for the profiles that need one (see
 * `snap-to-way.ts`). The ways come from the basemap's tiles around the point, read once and kept.
 *
 * An answer is a place (the point itself when nothing applies: running, or no tiles there), or
 * `null` when the point is refused: no usable way is close enough.
 */
@Injectable({ providedIn: 'root' })
export class WaySnapper {
  private readonly tiles = inject(WAY_TILES);
  /** Ways per tile (`null`: the basemap has no such tile), the latest read last. */
  private readonly cache = new Map<string, Way[] | null>();
  private readonly loading = new Map<string, Promise<void>>();

  /**
   * Where `point` lands, from the tiles already read; `undefined` when some are still to read
   * ({@link snap} reads them).
   */
  peek(
    point: LngLat,
    profile: string,
    maxMeters: number,
  ): LngLat | null | undefined {
    if (!snapsToWays(profile) || !this.tiles()) return point;
    const ways: Way[] = [];
    let outside = false;
    for (const key of this.keysAround(point, maxMeters)) {
      if (!this.cache.has(key)) return undefined;
      const tile = this.cache.get(key);
      if (tile) ways.push(...tile);
      else outside = true;
    }
    // Beside the basemap the ways are unknown: the routing engine will attach the point itself.
    return (
      snapToWay(point, ways, profile, maxMeters) ?? (outside ? point : null)
    );
  }

  /** Where `point` lands, reading the tiles around it first if needed. */
  async snap(
    point: LngLat,
    profile: string,
    maxMeters: number,
  ): Promise<LngLat | null> {
    const known = this.peek(point, profile, maxMeters);
    if (known !== undefined) return known;
    const keys = this.keysAround(point, maxMeters);
    await Promise.all(keys.map((key) => this.load(key)));
    const read = this.peek(point, profile, maxMeters);
    // A tile that could not be read: the point stays where it was placed.
    return read === undefined ? point : read;
  }

  /** The tiles that hold the places within `meters` of `point`: one, or up to four near an edge. */
  private keysAround(point: LngLat, meters: number): string[] {
    const dLat = meters / 111_320;
    const dLon = dLat / Math.cos((point[1] * Math.PI) / 180);
    const a = tileAt([point[0] - dLon, point[1] + dLat]);
    const b = tileAt([point[0] + dLon, point[1] - dLat]);
    const keys: string[] = [];
    for (let x = a.x; x <= b.x; x++) {
      for (let y = a.y; y <= b.y; y++) keys.push(`${x}/${y}`);
    }
    return keys;
  }

  private load(key: string): Promise<void> {
    if (this.cache.has(key)) return Promise.resolve();
    let pending = this.loading.get(key);
    if (!pending) {
      const read = this.tiles();
      const [x, y] = key.split('/').map(Number);
      pending = (read ? read(x, y) : Promise.resolve(null)).then(
        (ways) => {
          this.loading.delete(key);
          this.cache.set(key, ways);
          if (this.cache.size > CACHE_SIZE) {
            this.cache.delete(this.cache.keys().next().value as string);
          }
        },
        // Not kept: the next point placed there tries again.
        () => void this.loading.delete(key),
      );
      this.loading.set(key, pending);
    }
    return pending;
  }
}
