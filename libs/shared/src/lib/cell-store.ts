/**
 * One elevation file in memory: a grid of elevations over a box of longitudes and latitudes (a
 * Copernicus GLO-30 square of 1 degree is 3600 by 3600 values, 52 MB as floats).
 */
export interface Cell {
  west: number;
  north: number;
  /** Degrees per pixel. */
  stepX: number;
  stepY: number;
  width: number;
  height: number;
  data: Float32Array;
}

/** Reads one file; the store never reads the same one twice at once. */
export type CellLoader = (file: string) => Promise<Cell>;

/** `[west, south, east, north]` in degrees. */
export type CellBox = readonly [number, number, number, number];

/** The key of a 1 degree square: its south-west corner. */
export const cellKey = (south: number, west: number) =>
  `${Math.floor(south)}:${Math.floor(west)}`;

/**
 * Elevation at a place, between the four pixels around it, read from one cell; the edge pixels
 * are repeated beyond the cell. Pixel centres are half a pixel inside the box.
 */
export function sampleCell(cell: Cell, lon: number, lat: number): number {
  const fx = (lon - cell.west) / cell.stepX - 0.5;
  const fy = (cell.north - lat) / cell.stepY - 0.5;
  const x0 = Math.max(0, Math.min(cell.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(cell.height - 1, Math.floor(fy)));
  const x1 = Math.min(cell.width - 1, x0 + 1);
  const y1 = Math.min(cell.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const at = (x: number, y: number) => {
    const value = cell.data[y * cell.width + x];
    return Number.isFinite(value) ? value : 0;
  };
  return (
    (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) +
    (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
  );
}

/**
 * Elevation files read when a tile needs them, a few at a time: France is 133 files of 52 MB once
 * read, far more than memory holds. Files are found by the 1 degree square they cover; a square
 * with no file (open sea) reads as sea level.
 */
export class CellStore {
  /** Loaded or loading cells, oldest first. */
  private readonly cells = new Map<string, Promise<Cell>>();

  constructor(
    /** File of each square, by {@link cellKey}. */
    private readonly files: ReadonlyMap<string, string>,
    private readonly load: CellLoader,
    private readonly maxCells = 12,
  ) {}

  /** How many cells are kept right now. */
  get size(): number {
    return this.cells.size;
  }

  /**
   * Loads what `box` touches and returns the elevation at any place inside it (sea level where no
   * file covers). The cells of `box` are never dropped while they are in use.
   */
  async sampler(box: CellBox): Promise<(lon: number, lat: number) => number> {
    const needed = new Map<string, Cell>();
    const keys: string[] = [];
    for (let south = Math.floor(box[1]); south <= Math.floor(box[3]); south++) {
      for (let west = Math.floor(box[0]); west <= Math.floor(box[2]); west++) {
        keys.push(cellKey(south, west));
      }
    }
    await Promise.all(
      keys.map(async (key) => {
        const cell = await this.cell(key);
        if (cell) needed.set(key, cell);
      }),
    );
    this.evict(new Set(keys));
    return (lon, lat) => {
      const cell = needed.get(cellKey(lat, lon));
      return cell ? sampleCell(cell, lon, lat) : 0;
    };
  }

  private cell(key: string): Promise<Cell | null> {
    const file = this.files.get(key);
    if (!file) return Promise.resolve(null);
    let cell = this.cells.get(key);
    if (cell) {
      // Used again: it becomes the newest.
      this.cells.delete(key);
    } else {
      cell = this.load(file);
      // A failed read is not kept: the next tile tries again.
      cell.catch(() => this.cells.delete(key));
    }
    this.cells.set(key, cell);
    return cell;
  }

  private evict(inUse: ReadonlySet<string>): void {
    for (const key of [...this.cells.keys()]) {
      if (this.cells.size <= this.maxCells) return;
      if (!inUse.has(key)) this.cells.delete(key);
    }
  }
}
