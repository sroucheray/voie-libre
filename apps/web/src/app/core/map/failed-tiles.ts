/** Delay before the first automatic retry; it doubles after each failure. */
export const RETRY_DELAY_MS = 2000;
/** Automatic retries per tile. Moving the map tries again whatever the count. */
export const MAX_RETRIES = 4;

interface TileId {
  x: number;
  y: number;
  z: number;
}

interface TileErrorEvent {
  sourceId?: string;
  tile?: { tileID?: { canonical?: TileId } };
}

/** The part of the MapLibre map this needs. */
export interface TileRetryMap {
  on(type: 'error', listener: (event: TileErrorEvent) => void): unknown;
  on(type: 'moveend' | 'remove', listener: () => void): unknown;
  refreshTiles(sourceId: string, tileIds?: TileId[]): void;
}

interface FailedTile {
  sourceId: string;
  id: TileId;
  /** Automatic retries done so far. */
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Loads again the tiles that failed. MapLibre never retries a tile in error while it stays on
 * screen: after a short network failure the map kept holes, or the coarser tiles of a lower zoom,
 * until the tile left the view. Each failed tile is asked again after a growing delay, a few
 * times, and once more every time the map stops moving.
 */
export function retryFailedTiles(map: TileRetryMap): void {
  const failed = new Map<string, FailedTile>();

  const refresh = (tile: FailedTile): void => {
    try {
      map.refreshTiles(tile.sourceId, [tile.id]);
    } catch {
      // The source is gone (style change): nothing to load again.
    }
  };

  map.on('error', (event) => {
    const id = event.tile?.tileID?.canonical;
    const sourceId = event.sourceId;
    if (!id || !sourceId) return;
    const key = `${sourceId}/${id.z}/${id.x}/${id.y}`;
    const tile = failed.get(key) ?? {
      sourceId,
      id: { x: id.x, y: id.y, z: id.z },
      retries: 0,
      timer: null,
    };
    failed.set(key, tile);
    if (tile.timer !== null || tile.retries >= MAX_RETRIES) return;
    tile.timer = setTimeout(
      () => {
        tile.timer = null;
        tile.retries += 1;
        refresh(tile);
      },
      RETRY_DELAY_MS * 2 ** tile.retries,
    );
  });

  // A tile that loads this time is simply forgotten; one that fails again comes back through
  // the error event, with its automatic retries available again.
  map.on('moveend', () => {
    const tiles = [...failed.values()];
    failed.clear();
    for (const tile of tiles) {
      if (tile.timer !== null) clearTimeout(tile.timer);
      refresh(tile);
    }
  });

  map.on('remove', () => {
    for (const tile of failed.values()) {
      if (tile.timer !== null) clearTimeout(tile.timer);
    }
    failed.clear();
  });
}
