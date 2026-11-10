import {
  fromTerrarium,
  tilePixelToLngLat,
  tileRange,
  toTerrarium,
} from './relief-tiles';

describe('tileRange', () => {
  it('covers the test region at the zoom of the relief', () => {
    // Longitude 2.6 to 3.7, latitude 45.3 to 46.1: tiles are 0.176° wide at zoom 11.
    expect(tileRange([2.6, 45.3, 3.7, 46.1], 11)).toEqual({
      minX: 1038,
      maxX: 1045,
      minY: 727,
      maxY: 734,
    });
  });

  it('is one tile when the box fits in it, and stops at a tile edge', () => {
    expect(tileRange([2.6, 45.3, 3.7, 46.1], 6)).toEqual({
      minX: 32,
      maxX: 32,
      minY: 22,
      maxY: 22,
    });
    // Longitude 0 to 180 at zoom 1 is exactly the eastern column.
    expect(tileRange([0, 10, 180, 20], 1)).toMatchObject({ minX: 1, maxX: 1 });
  });
});

describe('tilePixelToLngLat', () => {
  it('gives the corners of a tile', () => {
    expect(tilePixelToLngLat(0, 0, 0, 0, 0)).toEqual([
      -180,
      expect.closeTo(85.0511, 3),
    ]);
    const [lon, lat] = tilePixelToLngLat(0, 0, 0, 256, 256);
    expect(lon).toBeCloseTo(0, 9);
    expect(lat).toBeCloseTo(0, 9);
  });

  it('agrees with the tile range', () => {
    const [lon, lat] = tilePixelToLngLat(1038, 727, 11, 256, 256);
    expect(tileRange([lon, lat, lon, lat], 11)).toMatchObject({
      minX: 1038,
      minY: 727,
    });
  });
});

describe('terrarium encoding', () => {
  it('goes back to the elevation, rounded to a quarter of a meter', () => {
    for (const meters of [0, 1464.9, 402.13, -12.3, 4808.75]) {
      const back = fromTerrarium(...toTerrarium(meters));
      expect(Math.abs(back - meters)).toBeLessThanOrEqual(0.125);
      expect(Number.isInteger(back * 4)).toBe(true);
    }
  });

  it('writes sea level as 128, 0, 0 and stays within a byte per channel', () => {
    expect(toTerrarium(0)).toEqual([128, 0, 0]);
    for (const meters of [-40000, 40000]) {
      for (const channel of toTerrarium(meters)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});
