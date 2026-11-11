import { wayLayerId, wayLayers, wayLevel } from './way-levels';

describe('wayLevel', () => {
  it('rates the ways for a road bike', () => {
    expect(wayLevel('road', 'cycleway')).toBe('good');
    expect(wayLevel('road', 'residential')).toBe('good');
    expect(wayLevel('road', 'tertiary_link')).toBe('good');
    expect(wayLevel('road', 'secondary')).toBe('fair');
    expect(wayLevel('road', 'trunk')).toBe('avoid');
    expect(wayLevel('road', 'motorway_link')).toBe('avoid');
    // Tracks and paths do not matter for a road bike: the basemap draws them as it does.
    expect(wayLevel('road', 'track')).toBeNull();
  });

  it('rates the ways for gravel', () => {
    expect(wayLevel('gravel', 'track')).toBe('good');
    expect(wayLevel('gravel', 'path')).toBe('good');
    expect(wayLevel('gravel', 'tertiary')).toBe('fair');
    expect(wayLevel('gravel', 'primary')).toBe('avoid');
    expect(wayLevel('gravel', 'footway')).toBeNull();
  });

  it('rates the ways for trail running', () => {
    expect(wayLevel('trail', 'footway')).toBe('good');
    expect(wayLevel('trail', 'path')).toBe('good');
    expect(wayLevel('trail', 'residential')).toBe('fair');
    expect(wayLevel('trail', 'secondary')).toBe('avoid');
    expect(wayLevel('trail', 'steps')).toBeNull();
  });

  it('gives no level to an unknown profile', () => {
    expect(wayLevel('boat', 'residential')).toBeNull();
  });

  it('never gives two levels to one way', () => {
    // wayLevel takes the first level that lists a way: the lists must not overlap.
    for (const profile of ['road', 'gravel', 'trail']) {
      const layers = wayLayers('protomaps', profile);
      const seen = new Set<string>();
      for (const layer of layers) {
        const filter = (layer as { filter: unknown[] }).filter;
        const values = (filter[2] as ['literal', string[]])[1];
        for (const value of values) {
          expect(seen.has(value)).toBe(false);
          seen.add(value);
        }
      }
    }
  });
});

describe('wayLayers', () => {
  it('draws the ways to avoid first and the suited ones last, over the roads layer', () => {
    const layers = wayLayers('protomaps', 'road');
    expect(layers.map((layer) => layer.id)).toEqual([
      wayLayerId('avoid'),
      wayLayerId('fair'),
      wayLayerId('good'),
    ]);
    for (const layer of layers) {
      expect(layer).toMatchObject({
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
      });
    }
  });

  it('dashes the ways to avoid, so that colour is not the only signal', () => {
    const [avoid, fair, good] = wayLayers('protomaps', 'gravel');
    expect(
      (avoid as { paint: Record<string, unknown> }).paint['line-dasharray'],
    ).toEqual([2, 2]);
    expect(
      (fair as { paint: Record<string, unknown> }).paint['line-dasharray'],
    ).toBeUndefined();
    expect(
      (good as { paint: Record<string, unknown> }).paint['line-dasharray'],
    ).toBeUndefined();
  });

  it('has no layer for an unknown profile', () => {
    expect(wayLayers('protomaps', 'boat')).toEqual([]);
  });
});
