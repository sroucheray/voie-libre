import {
  MAX_RETRIES,
  RETRY_DELAY_MS,
  TileRetryMap,
  retryFailedTiles,
} from './failed-tiles';

type Listener = (event?: unknown) => void;

class TilesMap {
  readonly refreshed: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    return this;
  }
  emit(type: string, event?: unknown) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
  refreshTiles(sourceId: string, ids?: { x: number; y: number; z: number }[]) {
    for (const id of ids ?? [])
      this.refreshed.push(`${sourceId}/${id.z}/${id.x}/${id.y}`);
  }
  fail(x: number, y: number, z = 13) {
    this.emit('error', {
      sourceId: 'protomaps',
      tile: { tileID: { canonical: { x, y, z } } },
    });
  }
}

describe('retryFailedTiles', () => {
  let map: TilesMap;

  beforeEach(() => {
    vi.useFakeTimers();
    map = new TilesMap();
    retryFailedTiles(map as unknown as TileRetryMap);
  });

  afterEach(() => vi.useRealTimers());

  it('loads a failed tile again after a delay', () => {
    map.fail(1, 2);
    expect(map.refreshed).toEqual([]);

    vi.advanceTimersByTime(RETRY_DELAY_MS);

    expect(map.refreshed).toEqual(['protomaps/13/1/2']);
  });

  it('waits longer after each failure and gives up after a few tries', () => {
    map.fail(1, 2);
    vi.advanceTimersByTime(RETRY_DELAY_MS);
    map.fail(1, 2);
    vi.advanceTimersByTime(RETRY_DELAY_MS);
    expect(map.refreshed).toHaveLength(1);
    vi.advanceTimersByTime(RETRY_DELAY_MS);
    expect(map.refreshed).toHaveLength(2);

    for (let i = 2; i < MAX_RETRIES + 3; i++) {
      map.fail(1, 2);
      vi.advanceTimersByTime(RETRY_DELAY_MS * 2 ** MAX_RETRIES);
    }

    expect(map.refreshed).toHaveLength(MAX_RETRIES);
  });

  it('loads every failed tile again when the map stops moving', () => {
    map.fail(1, 2);
    map.fail(3, 4);

    map.emit('moveend');

    expect(map.refreshed).toEqual(['protomaps/13/1/2', 'protomaps/13/3/4']);
    // The pending retries are dropped, and a tile that loaded is not asked again.
    vi.advanceTimersByTime(RETRY_DELAY_MS * 10);
    map.emit('moveend');
    expect(map.refreshed).toHaveLength(2);
  });

  it('retries after a move even once the automatic tries are used up', () => {
    for (let i = 0; i <= MAX_RETRIES; i++) {
      map.fail(1, 2);
      vi.advanceTimersByTime(RETRY_DELAY_MS * 2 ** MAX_RETRIES);
    }
    expect(map.refreshed).toHaveLength(MAX_RETRIES);

    map.emit('moveend');

    expect(map.refreshed).toHaveLength(MAX_RETRIES + 1);
  });

  it('ignores errors that are not about a tile', () => {
    map.emit('error', { error: new Error('style') });
    vi.advanceTimersByTime(RETRY_DELAY_MS * 10);
    map.emit('moveend');

    expect(map.refreshed).toEqual([]);
  });

  it('stops when the map is removed', () => {
    map.fail(1, 2);
    map.emit('remove');
    vi.advanceTimersByTime(RETRY_DELAY_MS * 10);

    expect(map.refreshed).toEqual([]);
  });

  it('survives a source that no longer exists', () => {
    map.refreshTiles = () => {
      throw new Error('no tile manager');
    };
    map.fail(1, 2);

    expect(() => vi.advanceTimersByTime(RETRY_DELAY_MS)).not.toThrow();
  });
});
