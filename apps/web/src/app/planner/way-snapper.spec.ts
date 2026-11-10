import { TestBed } from '@angular/core/testing';
import {
  tileAt,
  WAY_TILES,
  type Way,
  type WayTileReader,
} from '../core/map/way-tiles';
import { WaySnapper } from './way-snapper';

const road: Way = {
  kind: 'minor_road',
  detail: 'residential',
  line: [
    [3, 45],
    [3.02, 45],
  ],
};

describe('WaySnapper', () => {
  let reader: WayTileReader | null;
  let asked: string[];
  let snapper: WaySnapper;

  /** Ways for every tile, but `null` (no tile) or an error for those listed. */
  const tiles =
    (
      ways: Way[],
      { missing = [] as string[], failing = [] as string[] } = {},
    ): WayTileReader =>
    async (x, y) => {
      const key = `${x}/${y}`;
      asked.push(key);
      if (failing.includes(key)) throw new Error('unreadable');
      return missing.includes(key) ? null : ways;
    };
  const keyOf = (point: [number, number]) => {
    const { x, y } = tileAt(point);
    return `${x}/${y}`;
  };

  beforeEach(() => {
    asked = [];
    reader = tiles([road]);
    TestBed.configureTestingModule({
      providers: [{ provide: WAY_TILES, useValue: () => reader }],
    });
    snapper = TestBed.inject(WaySnapper);
  });

  it('does not know before the tile is read, and knows at once afterwards', async () => {
    expect(snapper.peek([3.005, 45.0003], 'road', 100)).toBeUndefined();
    const snapped = await snapper.snap([3.005, 45.0003], 'road', 100);
    expect(snapped?.[1]).toBeCloseTo(45, 6);
    expect(snapper.peek([3.0051, 45.0003], 'road', 100)?.[1]).toBeCloseTo(
      45,
      6,
    );
    const read = asked.length;
    await snapper.snap([3.0052, 45.0003], 'road', 100);
    expect(asked).toHaveLength(read);
  });

  it('refuses a point away from the ways of its profile', async () => {
    expect(await snapper.snap([3.005, 45.003], 'road', 100)).toBeNull();
    expect(snapper.peek([3.005, 45.003], 'gravel', 100)).toBeNull();
  });

  it('leaves the point alone for trail, and when there is no reader', async () => {
    expect(snapper.peek([3.005, 45.003], 'trail', 100)).toEqual([
      3.005, 45.003,
    ]);
    reader = null;
    expect(await snapper.snap([3.005, 45.003], 'road', 100)).toEqual([
      3.005, 45.003,
    ]);
    expect(asked).toEqual([]);
  });

  it('reads the neighbouring tile for a point near an edge', async () => {
    await snapper.snap([3.005, 45.0003], 'road', 100);
    expect(asked).toHaveLength(1);
    // A tile is about 1.7 km wide here: 3.0102° is some 30 m from the next one.
    asked = [];
    const { x } = tileAt([3.005, 45.0003]);
    const edge = ((x + 1) / 2 ** 14) * 360 - 180;
    await snapper.snap([edge - 0.0003, 45.0003], 'road', 100);
    expect(new Set(asked).size).toBe(1);
    expect(asked[0]).toBe(keyOf([edge + 0.0003, 45.0003]));
  });

  it('keeps a point placed where the basemap has no tile', async () => {
    reader = tiles([road], { missing: [keyOf([3.005, 45.003])] });
    expect(await snapper.snap([3.005, 45.003], 'road', 100)).toEqual([
      3.005, 45.003,
    ]);
  });

  it('keeps a point whose tile cannot be read, and tries again next time', async () => {
    reader = tiles([road], { failing: [keyOf([3.005, 45.003])] });
    expect(await snapper.snap([3.005, 45.003], 'road', 100)).toEqual([
      3.005, 45.003,
    ]);
    reader = tiles([road]);
    expect(await snapper.snap([3.005, 45.003], 'road', 100)).toBeNull();
  });
});
