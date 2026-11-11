/**
 * Builds the elevation tiles of the map's hillshade: data/basemap/relief.pmtiles (not committed),
 * from the Copernicus GLO-30 GeoTIFFs of data/relief (see scripts/download-relief.sh).
 *
 * Tiles are 512 px PNG images in the "terrarium" encoding, zooms 6 to 11, over the area the files
 * cover (or RELIEF_BBOX). Places without elevation data (open sea) are at sea level. The files are
 * read when a tile needs them, a dozen at a time (a 1 degree square is 52 MB in memory, France is
 * 133 of them). The tiles go to an MBTiles file first (SQLite), which the `pmtiles` command line
 * turns into one archive; without it, its Docker image is used, like in scripts/download-basemap.sh.
 *
 * Usage: npm run build-relief
 * Environment:
 *   RELIEF_BBOX    min_lon,min_lat,max_lon,max_lat   default: the squares of the files in RELIEF_DIR
 *                  (France with `scripts/download-relief.sh france`: about 9,000 tiles, 1.8 GB)
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
  CellStore,
  cellKey,
  type Cell,
} from '../libs/shared/src/lib/cell-store';
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

/** `Copernicus_DSM_COG_10_N45_00_E003_00_DEM.tif`: the square whose south-west corner is 45, 3. */
const FILE_NAME =
  /^Copernicus_DSM_COG_10_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM\.tif$/;

/** The elevation files of `reliefDir` by square, and the box they cover. */
function indexFiles(): { files: Map<string, string>; box: BoundingBox } {
  const files = new Map<string, string>();
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const name of existsSync(reliefDir) ? readdirSync(reliefDir) : []) {
    const match = FILE_NAME.exec(name);
    if (!match) continue;
    const lat = (match[1] === 'S' ? -1 : 1) * Number(match[2]);
    const lon = (match[3] === 'W' ? -1 : 1) * Number(match[4]);
    files.set(cellKey(lat, lon), join(reliefDir, name));
    west = Math.min(west, lon);
    east = Math.max(east, lon + 1);
    south = Math.min(south, lat);
    north = Math.max(north, lat + 1);
  }
  return { files, box: [west, south, east, north] };
}

/** Reads one GeoTIFF into memory as a {@link Cell}. */
async function loadCell(file: string): Promise<Cell> {
  const image = await (await fromFile(file)).getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const [data] = (await image.readRasters({
    samples: [0],
  })) as unknown as [Float32Array];
  return {
    west,
    north,
    stepX: (east - west) / width,
    stepY: (north - south) / height,
    width,
    height,
    data: Float32Array.from(data),
  };
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
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * One tile. At the deepest zoom a pixel takes the elevation at its centre; at the zooms above it
 * takes the mean of several places inside it, so that ridges do not flicker in and out.
 */
function renderTile(
  elevationAt: (lon: number, lat: number) => number,
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
          sum += elevationAt(lon, lat);
        }
      }
      rgb.set(toTerrarium(sum / (samples * samples)), (py * size + px) * 3);
    }
  }
  return encodePng(rgb, size);
}

/** `[west, south, east, north]` of a tile. */
function tileBox(x: number, y: number, zoom: number): BoundingBox {
  const [west, north] = tilePixelToLngLat(x, y, zoom, 0, 0);
  const [east, south] = tilePixelToLngLat(
    x,
    y,
    zoom,
    RELIEF_TILE_SIZE,
    RELIEF_TILE_SIZE,
  );
  return [west, south, east, north];
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
  const { files, box } = indexFiles();
  if (files.size === 0) {
    console.error(
      `No elevation file in ${reliefDir}: run scripts/download-relief.sh first.`,
    );
    process.exit(1);
  }
  const bbox = process.env['RELIEF_BBOX']
    ? (process.env['RELIEF_BBOX']
        .split(',')
        .map(Number) as unknown as BoundingBox)
    : box;
  console.log(`${files.size} files, building ${bbox.join(',')}`);
  const store = new CellStore(files, loadCell);
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
  let total = 0;
  for (let zoom = RELIEF_MIN_ZOOM; zoom <= RELIEF_MAX_ZOOM; zoom++) {
    const range = tileRange(bbox, zoom);
    total += (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
  }
  const started = Date.now();
  let count = 0;
  db.exec('BEGIN');
  for (let zoom = RELIEF_MIN_ZOOM; zoom <= RELIEF_MAX_ZOOM; zoom++) {
    const range = tileRange(bbox, zoom);
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const elevation = await store.sampler(tileBox(x, y, zoom));
        // MBTiles counts rows from the south.
        insert.run(
          zoom,
          x,
          2 ** zoom - 1 - y,
          renderTile(elevation, x, y, zoom),
        );
        count++;
        if (count % 200 === 0) {
          db.exec('COMMIT');
          db.exec('BEGIN');
        }
        if (count % 250 === 0) {
          const seconds = (Date.now() - started) / 1000;
          const left = Math.round(((seconds / count) * (total - count)) / 60);
          console.log(
            `Zoom ${zoom}: ${count} of ${total} tiles, about ${left} min left`,
          );
        }
      }
    }
  }
  db.exec('COMMIT');
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
