import { routesToGeoJson } from './route-geojson';

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
