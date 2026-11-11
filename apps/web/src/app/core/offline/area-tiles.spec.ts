import {
  boxAround,
  boxTiles,
  corridorTiles,
  countBoxTiles,
  tileOf,
  viewBox,
  type Box,
} from './area-tiles';

describe('tileOf', () => {
  it('finds the tile of a place, known cases', () => {
    // Clermont-Ferrand at zoom 14 (checked against the tiles of the local archive).
    expect(tileOf(3.087, 45.777, 14)).toEqual({ z: 14, x: 8332, y: 5843 });
    expect(tileOf(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(tileOf(-180, 85, 0)).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('clamps the poles and the antimeridian into the pyramid', () => {
    expect(tileOf(180, 90, 3)).toEqual({ z: 3, x: 7, y: 0 });
    expect(tileOf(-200, -90, 3)).toEqual({ z: 3, x: 0, y: 7 });
  });
});

describe('boxTiles', () => {
  const world: Box = [-179.99, -85, 179.99, 85];
  it('has 4^z tiles over the world at zoom z, and one tile at zoom 0', () => {
    expect(countBoxTiles(world, 0, 0)).toBe(1);
    expect(countBoxTiles(world, 2, 2)).toBe(16);
    expect(countBoxTiles(world, 0, 3)).toBe(1 + 4 + 16 + 64);
  });

  it('lists exactly what it counts', () => {
    const box: Box = [3.05, 45.76, 3.14, 45.82];
    const tiles = boxTiles(box, 8, 14);
    expect(tiles).toHaveLength(countBoxTiles(box, 8, 14));
    expect(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(
      tiles.length,
    );
    expect(tiles.every((t) => t.z >= 8 && t.z <= 14)).toBe(true);
  });

  it('holds the tile of a point at every zoom', () => {
    const point = tileOf(3.087, 45.777, 12);
    const tiles = boxTiles([3.0, 45.7, 3.2, 45.9], 12, 12);
    expect(tiles).toContainEqual(point);
  });
});

describe('boxAround', () => {
  it('grows the box of a line by the margin, a bit more in longitude than in latitude', () => {
    const box = boxAround(
      [
        [3, 45],
        [3.1, 45.1],
      ],
      5000,
    );
    expect(box[0]).toBeLessThan(3);
    expect(box[2]).toBeGreaterThan(3.1);
    expect(box[1]).toBeLessThan(45);
    expect(box[3]).toBeGreaterThan(45.1);
    // 5 km is about 0.045 degrees of latitude and 0.064 of longitude at 45 degrees.
    expect(45 - box[1]).toBeCloseTo(0.045, 2);
    expect(3 - box[0]).toBeCloseTo(0.064, 2);
  });
});

describe('corridorTiles', () => {
  // About 22 km of straight road, west to east.
  const road: [number, number][] = [
    [3.0, 45.5],
    [3.28, 45.5],
  ];

  it('is empty for an empty line and one tile for a point at low zoom', () => {
    expect(corridorTiles([], 5000, 0, 14)).toEqual([]);
    expect(corridorTiles([[3, 45]], 100, 0, 3)).toHaveLength(4);
  });

  it('holds the tile of every vertex of the route at every zoom', () => {
    const tiles = corridorTiles(road, 1000, 6, 14);
    for (const vertex of road) {
      for (let z = 6; z <= 14; z++) {
        expect(tiles).toContainEqual(tileOf(vertex[0], vertex[1], z));
      }
    }
  });

  it('holds the tiles in the middle of the road, not only its ends', () => {
    const tiles = corridorTiles(road, 500, 14, 14);
    const middle = tileOf(3.14, 45.5, 14);
    expect(tiles).toContainEqual(middle);
    // About 22 km of road at 1.7 km a tile: a dozen columns at least.
    expect(new Set(tiles.map((t) => t.x)).size).toBeGreaterThan(11);
  });

  it('has no tile twice, and grows with the width of the corridor', () => {
    const narrow = corridorTiles(road, 500, 12, 14);
    const wide = corridorTiles(road, 5000, 12, 14);
    expect(new Set(narrow.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(
      narrow.length,
    );
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it('is much smaller than the box around the road', () => {
    const diagonal: [number, number][] = [
      [3.0, 45.0],
      [3.6, 45.6],
    ];
    const corridor = corridorTiles(diagonal, 2000, 14, 14).length;
    const box = countBoxTiles(boxAround(diagonal, 2000), 14, 14);
    expect(corridor).toBeLessThan(box / 3);
  });
});

describe('viewBox', () => {
  it('is centred on the map and as wide as the pixels say', () => {
    // Zoom 0: the world is 512 px wide, so 512 px show 360 degrees.
    const world = viewBox([0, 0], 0, 512, 512);
    expect(world[2] - world[0]).toBeCloseTo(360, 6);
    expect(world[0]).toBeCloseTo(-180, 6);
    // Each zoom halves the span.
    const closer = viewBox([3, 45.7], 10, 1024, 768);
    expect(closer[2] - closer[0]).toBeCloseTo((360 / 2 ** 10 / 512) * 1024, 6);
    expect((closer[0] + closer[2]) / 2).toBeCloseTo(3, 6);
    expect((closer[1] + closer[3]) / 2).toBeCloseTo(45.7, 1);
  });

  it('holds the tile of its own centre', () => {
    const box = viewBox([3.087, 45.777], 12, 800, 600);
    expect(boxTiles(box, 12, 12)).toContainEqual(tileOf(3.087, 45.777, 12));
  });
});
