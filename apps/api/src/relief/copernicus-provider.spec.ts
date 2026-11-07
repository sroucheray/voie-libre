import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArrayBuffer } from 'geotiff';
import {
  CopernicusElevationProvider,
  tileFileName,
} from './copernicus-provider';

/**
 * A 4 x 4 cell tile for lon 3..4, lat 45..46 (cell = 0.25 degree) where the elevation is
 * `100 * column + 10 * row`, so every expected value is easy to compute by hand.
 */
async function writeTile(directory: string, noDataCell = false) {
  const width = 4;
  const height = 4;
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      values[row * width + col] = 100 * col + 10 * row;
    }
  }
  if (noDataCell) values[0] = -32768;
  const buffer = await writeArrayBuffer(values, {
    width,
    height,
    ModelPixelScale: [0.25, 0.25, 0],
    ModelTiepoint: [0, 0, 0, 3, 46, 0],
    GTRasterTypeGeoKey: 1,
    GeographicTypeGeoKey: 4326,
    GDAL_NODATA: '-32768',
  } as never);
  await writeFile(
    join(directory, tileFileName(3.5, 45.5)),
    Buffer.from(buffer),
  );
}

describe('tileFileName', () => {
  it('names the Copernicus tile after its south-west corner', () => {
    expect(tileFileName(3.087, 45.777)).toBe(
      'Copernicus_DSM_COG_10_N45_00_E003_00_DEM.tif',
    );
    expect(tileFileName(-0.5, -1.2)).toBe(
      'Copernicus_DSM_COG_10_S02_00_W001_00_DEM.tif',
    );
  });
});

describe('CopernicusElevationProvider', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'relief-'));
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('reads the cell value at a cell centre', async () => {
    await writeTile(directory);
    const provider = new CopernicusElevationProvider(directory);
    // Centre of the cell at column 1, row 2: lon 3.375, lat 46 - 2.5 * 0.25 = 45.375.
    expect(await provider.elevations([{ lon: 3.375, lat: 45.375 }])).toEqual([
      120,
    ]);
  });

  it('interpolates between cells', async () => {
    await writeTile(directory);
    const provider = new CopernicusElevationProvider(directory);
    // Halfway between the centres of columns 1 and 2 on row 2: (120 + 220) / 2.
    const [value] = await provider.elevations([{ lon: 3.5, lat: 45.375 }]);
    expect(value).toBe(170);
  });

  it('keeps the order and mixes tiles, answering null where there is no data', async () => {
    await writeTile(directory);
    const provider = new CopernicusElevationProvider(directory);
    const values = await provider.elevations([
      { lon: 3.875, lat: 45.875 },
      { lon: 10.5, lat: 45.5 }, // tile not downloaded
      { lon: 3.125, lat: 45.125 },
    ]);
    expect(values).toEqual([300, null, 30]);
  });

  it('clamps at the edge of the tile instead of failing', async () => {
    await writeTile(directory);
    const provider = new CopernicusElevationProvider(directory);
    const [value] = await provider.elevations([{ lon: 3.999, lat: 45.001 }]);
    expect(value).toBeGreaterThan(300);
  });

  it('ignores no-data cells', async () => {
    await writeTile(directory, true);
    const provider = new CopernicusElevationProvider(directory);
    // The top-left cell is no data: a point near it uses the three others, re-weighted.
    const [value] = await provider.elevations([{ lon: 3.2, lat: 45.8 }]);
    expect(value).not.toBeNull();
    expect(value).not.toBe(-32768);
  });

  it('finds a tile downloaded after a first miss', async () => {
    const provider = new CopernicusElevationProvider(directory);
    expect(await provider.elevations([{ lon: 3.5, lat: 45.5 }])).toEqual([
      null,
    ]);
    await writeTile(directory);
    expect(
      (await provider.elevations([{ lon: 3.5, lat: 45.5 }]))[0],
    ).not.toBeNull();
  });
});
