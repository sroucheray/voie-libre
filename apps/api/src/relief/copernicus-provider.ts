import { join } from 'node:path';
import { fromFile, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import type {
  ElevationPosition,
  ElevationProvider,
} from './elevation-provider';

/** A 1 x 1 degree tile, named after its south-west corner. */
interface Tile {
  image: GeoTIFFImage;
  width: number;
  height: number;
  /** South-west corner. */
  lon0: number;
  lat0: number;
}

/** File name of the Copernicus GLO-30 tile covering `lon`, `lat` (see scripts/download-relief.sh). */
export function tileFileName(lon: number, lat: number): string {
  const south = Math.floor(lat);
  const west = Math.floor(lon);
  const ns = `${south >= 0 ? 'N' : 'S'}${String(Math.abs(south)).padStart(2, '0')}`;
  const ew = `${west >= 0 ? 'E' : 'W'}${String(Math.abs(west)).padStart(3, '0')}`;
  return `Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM.tif`;
}

/**
 * Elevations from Copernicus GLO-30 GeoTIFF tiles stored on disk. Each tile is opened once;
 * for a request, the points of a tile are read with a single window, then interpolated
 * bilinearly between the four surrounding cells.
 *
 * Data: Copernicus DEM GLO-30, provided under COPERNICUS by the European Union and ESA.
 */
export class CopernicusElevationProvider implements ElevationProvider {
  private readonly tiles = new Map<string, Promise<Tile | null>>();

  constructor(private readonly directory: string) {}

  async elevations(points: ElevationPosition[]): Promise<(number | null)[]> {
    const result: (number | null)[] = points.map(() => null);
    const byTile = new Map<string, number[]>();
    points.forEach((point, index) => {
      const key = tileFileName(point.lon, point.lat);
      const list = byTile.get(key);
      if (list) list.push(index);
      else byTile.set(key, [index]);
    });

    await Promise.all(
      [...byTile].map(async ([fileName, indexes]) => {
        const tile = await this.tile(fileName);
        if (!tile) return;
        const values = await this.read(
          tile,
          indexes.map((i) => points[i]),
        );
        indexes.forEach((pointIndex, i) => (result[pointIndex] = values[i]));
      }),
    );
    return result;
  }

  private tile(fileName: string): Promise<Tile | null> {
    let tile = this.tiles.get(fileName);
    if (!tile) {
      tile = this.open(fileName);
      this.tiles.set(fileName, tile);
    }
    return tile;
  }

  /** `null` when the tile was not downloaded. A later download needs no restart. */
  private async open(fileName: string): Promise<Tile | null> {
    let file: GeoTIFF;
    try {
      file = await fromFile(join(this.directory, fileName));
    } catch {
      this.tiles.delete(fileName);
      return null;
    }
    const image = await file.getImage();
    const [west, , , north] = image.getBoundingBox();
    return {
      image,
      width: image.getWidth(),
      height: image.getHeight(),
      lon0: Math.round(west),
      lat0: Math.round(north) - 1,
    };
  }

  private async read(
    tile: Tile,
    points: ElevationPosition[],
  ): Promise<(number | null)[]> {
    // Fractional cell coordinates of each point (cell centres are at +0.5).
    const cells = points.map((point) => ({
      x: (point.lon - tile.lon0) * tile.width - 0.5,
      y: (tile.lat0 + 1 - point.lat) * tile.height - 0.5,
    }));
    const clampX = (x: number) => Math.min(tile.width - 1, Math.max(0, x));
    const clampY = (y: number) => Math.min(tile.height - 1, Math.max(0, y));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { x, y } of cells) {
      minX = Math.min(minX, clampX(Math.floor(x)));
      minY = Math.min(minY, clampY(Math.floor(y)));
      maxX = Math.max(maxX, clampX(Math.floor(x) + 1));
      maxY = Math.max(maxY, clampY(Math.floor(y) + 1));
    }

    const width = maxX - minX + 1;
    const raster = (await tile.image.readRasters({
      window: [minX, minY, maxX + 1, maxY + 1],
      samples: [0],
      interleave: true,
    })) as unknown as ArrayLike<number>;
    const noData = tile.image.getGDALNoData();
    const at = (x: number, y: number): number | null => {
      const value = raster[(clampY(y) - minY) * width + (clampX(x) - minX)];
      return Number.isFinite(value) && value !== noData ? value : null;
    };

    return cells.map(({ x, y }) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = Math.min(1, Math.max(0, x - x0));
      const fy = Math.min(1, Math.max(0, y - y0));
      const corners = [
        [at(x0, y0), (1 - fx) * (1 - fy)],
        [at(x0 + 1, y0), fx * (1 - fy)],
        [at(x0, y0 + 1), (1 - fx) * fy],
        [at(x0 + 1, y0 + 1), fx * fy],
      ] as const;
      // A cell without data is left out and the others are re-weighted.
      let sum = 0;
      let weight = 0;
      for (const [value, w] of corners) {
        if (value !== null && w > 0) {
          sum += value * w;
          weight += w;
        }
      }
      return weight > 0 ? Math.round((sum / weight) * 10) / 10 : null;
    });
  }
}
