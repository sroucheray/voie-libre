/**
 * Builds the elevation tiles of the map's hillshade: data/basemap/relief.pmtiles (not committed),
 * from the Copernicus GLO-30 GeoTIFFs of data/relief (see scripts/download-relief.sh).
 *
 * Tiles are 512 px PNG images in the "terrarium" encoding, zooms 6 to 11, over the area of the
 * basemap. Places without elevation data are at sea level. The tiles go to an MBTiles file first
 * (SQLite), which the `pmtiles` command line turns into one archive; without it, its Docker image
 * is used, like in scripts/download-basemap.sh.
 *
 * Usage: npm run build-relief
 * Environment:
 *   RELIEF_BBOX    min_lon,min_lat,max_lon,max_lat   default: 2.6,45.3,3.7,46.1 (the Copernicus
 *                  files in data/relief decide how far it can go)
 *   RELIEF_DIR     where the GeoTIFFs are            default: data/relief
 *   BASEMAP_DIR    where the archive goes            default: data/basemap
 *   PMTILES_BIN    pmtiles CLI to use; default: `pmtiles` if installed, else the Docker image
 *
 * Data: Copernicus DEM GLO-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
 * 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crc32, deflateSync } from 'node:zlib';
import { fromFile } from 'geotiff';
import {
  RELIEF_MAX_ZOOM,
  RELIEF_MIN_ZOOM,
  RELIEF_TILE_SIZE,
  RELIEF_TILES_FILE,
  tilePixelToLngLat,
  tileRange,
  toTerrarium,
  type BoundingBox,
} from '../libs/shared/src/lib/relief-tiles';

const root = join(__dirname, '..');
const reliefDir = resolve(root, process.env['RELIEF_DIR'] ?? 'data/relief');
const outDir = resolve(root, process.env['BASEMAP_DIR'] ?? 'data/basemap');
const bbox = (process.env['RELIEF_BBOX'] ?? '2.6,45.3,3.7,46.1')
  .split(',')
  .map(Number) as unknown as BoundingBox;

/** One GeoTIFF in memory: a grid of elevations over a box of longitudes and latitudes. */
interface Cell {
  west: number;
  north: number;
  /** Degrees per pixel. */
  stepX: number;
  stepY: number;
  width: number;
  height: number;
  data: Float32Array;
}

async function loadCells(): Promise<Cell[]> {
  const files = existsSync(reliefDir)
    ? readdirSync(reliefDir).filter((name) => name.endsWith('.tif'))
    : [];
  const cells: Cell[] = [];
  for (const name of files) {
    const image = await (await fromFile(join(reliefDir, name))).getImage();
    const [west, south, east, north] = image.getBoundingBox();
    // Skip the files that do not touch the area.
    if (
      east <= bbox[0] ||
      west >= bbox[2] ||
      north <= bbox[1] ||
      south >= bbox[3]
    ) {
      continue;
    }
    const width = image.getWidth();
    const height = image.getHeight();
    const [data] = (await image.readRasters({
      samples: [0],
    })) as unknown as [Float32Array];
    cells.push({
      west,
      north,
      stepX: (east - west) / width,
      stepY: (north - south) / height,
      width,
      height,
      data: Float32Array.from(data),
    });
    console.log(`Read ${name} (${width} x ${height})`);
  }
  return cells;
}

/** Elevation at a place, between the four pixels around it; 0 where no file has it. */
function elevationAt(cells: readonly Cell[], lon: number, lat: number): number {
  for (const cell of cells) {
    // Pixel centres are half a pixel inside the box.
    const fx = (lon - cell.west) / cell.stepX - 0.5;
    const fy = (cell.north - lat) / cell.stepY - 0.5;
    if (
      fx < -0.5 ||
      fy < -0.5 ||
      fx > cell.width - 0.5 ||
      fy > cell.height - 0.5
    ) {
      continue;
    }
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
  return 0;
}

/** A PNG chunk: length, type, data, CRC of the type and the data. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

/** An 8-bit RGB PNG of `size` x `size` pixels. Rows use the "sub" filter: slopes compress well. */
function encodePng(rgb: Uint8Array, size: number): Buffer {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    raw[row] = 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? rgb[y * stride + i - 3] : 0;
      raw[row + 1 + i] = (rgb[y * stride + i] - left) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * One tile. At the deepest zoom a pixel takes the elevation at its centre; at the zooms above it
 * takes the mean of several places inside it, so that ridges do not flicker in and out.
 */
function renderTile(
  cells: readonly Cell[],
  x: number,
  y: number,
  zoom: number,
): Buffer {
  const size = RELIEF_TILE_SIZE;
  const samples = Math.min(4, 2 ** (RELIEF_MAX_ZOOM - zoom));
  const rgb = new Uint8Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sum = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const [lon, lat] = tilePixelToLngLat(
            x,
            y,
            zoom,
            px + (sx + 0.5) / samples,
            py + (sy + 0.5) / samples,
          );
          sum += elevationAt(cells, lon, lat);
        }
      }
      rgb.set(toTerrarium(sum / (samples * samples)), (py * size + px) * 3);
    }
  }
  return encodePng(rgb, size);
}

function convert(mbtiles: string, archive: string): void {
  const bin =
    process.env['PMTILES_BIN'] ??
    (spawnSync('pmtiles', ['version']).error ? null : 'pmtiles');
  if (bin) {
    execFileSync(bin, ['convert', mbtiles, archive], { stdio: 'inherit' });
    return;
  }
  // No local CLI: use the official image, writing as the current user.
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      `${process.getuid?.()}:${process.getgid?.()}`,
      '-v',
      `${outDir}:/out`,
      'protomaps/go-pmtiles',
      'convert',
      '/out/relief.mbtiles',
      `/out/${RELIEF_TILES_FILE}.part`,
    ],
    { stdio: 'inherit' },
  );
}

async function main() {
  const cells = await loadCells();
  if (cells.length === 0) {
    console.error(
      `No elevation file for the area in ${reliefDir}: run scripts/download-relief.sh first.`,
    );
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const mbtiles = join(outDir, 'relief.mbtiles');
  const part = join(outDir, `${RELIEF_TILES_FILE}.part`);
  const archive = join(outDir, RELIEF_TILES_FILE);
  rmSync(mbtiles, { force: true });
  rmSync(part, { force: true });

  const db = new DatabaseSync(mbtiles);
  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);
  const meta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
  for (const [name, value] of [
    ['name', 'Voie Libre relief'],
    ['format', 'png'],
    ['type', 'overlay'],
    ['minzoom', String(RELIEF_MIN_ZOOM)],
    ['maxzoom', String(RELIEF_MAX_ZOOM)],
    ['bounds', bbox.join(',')],
    ['attribution', 'Copernicus DEM GLO-30'],
  ]) {
    meta.run(name, value);
  }
  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  let count = 0;
  for (let zoom = RELIEF_MIN_ZOOM; zoom <= RELIEF_MAX_ZOOM; zoom++) {
    const range = tileRange(bbox, zoom);
    db.exec('BEGIN');
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        // MBTiles counts rows from the south.
        insert.run(zoom, x, 2 ** zoom - 1 - y, renderTile(cells, x, y, zoom));
        count++;
      }
    }
    db.exec('COMMIT');
    console.log(`Zoom ${zoom}: tiles up to ${count}`);
  }
  db.close();

  convert(mbtiles, part);
  rmSync(archive, { force: true });
  execFileSync('mv', [part, archive]);
  rmSync(mbtiles, { force: true });
  const megabytes = (statSync(archive).size / 1e6).toFixed(1);
  console.log(`Relief ready: ${archive} (${count} tiles, ${megabytes} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
