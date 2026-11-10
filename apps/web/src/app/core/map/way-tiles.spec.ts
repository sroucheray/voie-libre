import { tileAt, WAY_TILE_ZOOM } from './way-tiles';

describe('tileAt', () => {
  it('finds the tile of a place at the zoom of the ways', () => {
    // Clermont-Ferrand.
    expect(tileAt([3.087, 45.777])).toEqual({ x: 8332, y: 5843 });
    expect(WAY_TILE_ZOOM).toBe(14);
  });

  it('stays inside the world', () => {
    expect(tileAt([-200, 89.9], 2)).toEqual({ x: 0, y: 0 });
    expect(tileAt([200, -89.9], 2)).toEqual({ x: 3, y: 3 });
  });
});
