import { routesToGeoJson, surfacesToGeoJson } from './route-geojson';

describe('routesToGeoJson', () => {
  const a: [number, number, number][] = [
    [3, 45, 400],
    [3.1, 45.1, 410],
  ];
  const b: [number, number, number][] = [
    [3, 45, 400],
    [3.2, 45.2, 420],
  ];

  it('draws one line per route and flags the selected one', () => {
    const collection = routesToGeoJson([a, b], 1);
    expect(collection.features.map((f) => f.properties)).toEqual([
      { index: 0, selected: false },
      { index: 1, selected: true },
    ]);
    expect(collection.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: a,
    });
  });

  it('is empty without routes', () => {
    expect(routesToGeoJson([], 0).features).toEqual([]);
  });
});

describe('surfacesToGeoJson', () => {
  const geometry: [number, number, number][] = [
    [3, 45, 0],
    [3.1, 45, 0],
    [3.2, 45, 0],
    [3.3, 45, 0],
  ];

  it('cuts the route into one line per run of one category, sharing their end vertices', () => {
    const { features } = surfacesToGeoJson(geometry, 'ppu');
    expect(features.map((f) => f.properties.code)).toEqual(['p', 'u']);
    expect(features[0].geometry.coordinates).toEqual(geometry.slice(0, 3));
    expect(features[1].geometry.coordinates).toEqual(geometry.slice(2, 4));
  });

  it('draws nothing when the codes do not fit the geometry', () => {
    expect(surfacesToGeoJson(geometry, 'pp').features).toEqual([]);
    expect(surfacesToGeoJson([], '').features).toEqual([]);
  });
});
