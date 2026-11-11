import { CellStore, cellKey, sampleCell, type Cell } from './cell-store';

/** A 2 by 2 grid over the square whose south-west corner is `south`, `west`, all at `value`. */
const square = (south: number, west: number, value: number): Cell => ({
  west,
  north: south + 1,
  stepX: 0.5,
  stepY: 0.5,
  width: 2,
  height: 2,
  data: new Float32Array(4).fill(value),
});

function setup(squares: [number, number][], maxCells = 12) {
  const files = new Map(
    squares.map(([south, west]) => [cellKey(south, west), `f${south}_${west}`]),
  );
  const loads: string[] = [];
  const store = new CellStore(
    files,
    async (file) => {
      loads.push(file);
      const [south, west] = file.slice(1).split('_').map(Number);
      return square(south, west, south * 1000 + west);
    },
    maxCells,
  );
  return { store, loads };
}

describe('sampleCell', () => {
  it('interpolates between the four pixels around a place', () => {
    const cell: Cell = {
      west: 0,
      north: 1,
      stepX: 0.5,
      stepY: 0.5,
      width: 2,
      height: 2,
      // Row by row from the north: 0 100 / 200 300.
      data: Float32Array.from([0, 100, 200, 300]),
    };
    // The middle of the square is the mean of the four pixels.
    expect(sampleCell(cell, 0.5, 0.5)).toBeCloseTo(150, 6);
    // On the centre of the north-west pixel.
    expect(sampleCell(cell, 0.25, 0.75)).toBeCloseTo(0, 6);
    // Beyond the last pixel centre the edge value is repeated.
    expect(sampleCell(cell, 0.99, 0.01)).toBeCloseTo(300, 6);
  });

  it('reads no-data values as sea level', () => {
    const cell: Cell = {
      ...square(0, 0, 0),
      data: new Float32Array(4).fill(NaN),
    };
    expect(sampleCell(cell, 0.5, 0.5)).toBe(0);
  });
});

describe('CellStore', () => {
  it('reads the elevation of the square a place is in, and sea level where there is no file', async () => {
    const { store } = setup([[45, 3]]);
    const at = await store.sampler([3.2, 45.2, 3.4, 45.4]);
    expect(at(3.3, 45.3)).toBe(45 * 1000 + 3);
    const sea = await store.sampler([3.2, 44.2, 3.4, 44.4]);
    expect(sea(3.3, 44.3)).toBe(0);
  });

  it('reads a place on a border from the square that starts there', async () => {
    const { store } = setup([
      [45, 3],
      [45, 4],
    ]);
    const at = await store.sampler([3.9, 45.1, 4.1, 45.2]);
    expect(at(3.95, 45.15)).toBe(45 * 1000 + 3);
    expect(at(4.0, 45.15)).toBe(45 * 1000 + 4);
    expect(at(4.05, 45.15)).toBe(45 * 1000 + 4);
  });

  it('loads a file only when a tile needs it, and once', async () => {
    const { store, loads } = setup([
      [45, 3],
      [45, 4],
      [46, 3],
    ]);
    expect(loads).toEqual([]);
    await store.sampler([3.1, 45.1, 3.2, 45.2]);
    await store.sampler([3.3, 45.3, 3.4, 45.4]);
    expect(loads).toEqual(['f45_3']);
    await store.sampler([3.5, 45.5, 4.5, 45.6]);
    expect(loads).toEqual(['f45_3', 'f45_4']);
  });

  it('reads one file once when two tiles ask for it at the same time', async () => {
    const { store, loads } = setup([[45, 3]]);
    await Promise.all([
      store.sampler([3.1, 45.1, 3.2, 45.2]),
      store.sampler([3.3, 45.3, 3.4, 45.4]),
    ]);
    expect(loads).toEqual(['f45_3']);
  });

  it('keeps at most the asked number of files and drops the oldest', async () => {
    const { store, loads } = setup(
      [
        [45, 1],
        [45, 2],
        [45, 3],
        [45, 4],
      ],
      2,
    );
    for (const west of [1, 2, 3, 4]) {
      await store.sampler([west + 0.1, 45.1, west + 0.2, 45.2]);
      expect(store.size).toBeLessThanOrEqual(2);
    }
    // The first one was dropped: needing it again reads it again.
    await store.sampler([1.1, 45.1, 1.2, 45.2]);
    expect(loads.filter((file) => file === 'f45_1')).toHaveLength(2);
  });

  it('keeps every file a tile needs even above the limit', async () => {
    const { store } = setup(
      [
        [45, 3],
        [45, 4],
        [46, 3],
        [46, 4],
      ],
      1,
    );
    const at = await store.sampler([3.9, 45.9, 4.1, 46.1]);
    expect(at(3.95, 45.95)).toBe(45 * 1000 + 3);
    expect(at(4.05, 45.95)).toBe(45 * 1000 + 4);
    expect(at(3.95, 46.05)).toBe(46 * 1000 + 3);
    expect(at(4.05, 46.05)).toBe(46 * 1000 + 4);
  });

  it('does not keep a failed read, so that the next tile tries again', async () => {
    let fail = true;
    const files = new Map([[cellKey(45, 3), 'f45_3']]);
    const store = new CellStore(files, async () => {
      if (fail) throw new Error('disk');
      return square(45, 3, 7);
    });
    await expect(store.sampler([3.1, 45.1, 3.2, 45.2])).rejects.toThrow('disk');
    fail = false;
    const at = await store.sampler([3.1, 45.1, 3.2, 45.2]);
    expect(at(3.15, 45.15)).toBe(7);
  });
});
