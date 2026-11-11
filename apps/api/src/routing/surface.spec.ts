import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyWay, surfacesFromMessages } from './surface';
import { parseGeoJson } from './brouter-provider';

describe('classifyWay', () => {
  it('puts a paved surface first, whatever the way', () => {
    expect(classifyWay('highway=residential surface=asphalt')).toBe('p');
    expect(
      classifyWay('highway=footway surface=asphalt footway=crossing'),
    ).toBe('p');
    expect(classifyWay('highway=track surface=concrete')).toBe('p');
    expect(classifyWay('highway=path surface=paving_stones')).toBe('p');
  });

  it('takes a road class with no surface for paved', () => {
    expect(classifyWay('highway=tertiary maxspeed=80')).toBe('p');
    expect(classifyWay('highway=service service=driveway')).toBe('p');
    expect(classifyWay('highway=pedestrian')).toBe('p');
  });

  it('tells cycleways apart, unless their surface is unpaved', () => {
    expect(classifyWay('highway=cycleway')).toBe('c');
    expect(classifyWay('highway=cycleway surface=asphalt oneway=no')).toBe('c');
    expect(classifyWay('highway=cycleway surface=compacted')).toBe('u');
  });

  it('puts unpaved surfaces and bare tracks with the unpaved', () => {
    expect(classifyWay('highway=track surface=gravel tracktype=grade2')).toBe(
      'u',
    );
    expect(classifyWay('highway=residential surface=dirt')).toBe('u');
    expect(classifyWay('highway=track tracktype=grade3')).toBe('u');
    // A rough ride, though paved.
    expect(classifyWay('highway=residential surface=sett')).toBe('u');
  });

  it('calls a path with no paved surface a path', () => {
    expect(classifyWay('highway=path')).toBe('s');
    expect(classifyWay('highway=path surface=ground')).toBe('u');
    expect(classifyWay('highway=bridleway')).toBe('s');
    expect(classifyWay('highway=steps')).toBe('s');
  });

  it('says unknown when nothing is known', () => {
    expect(classifyWay('')).toBe('?');
    expect(classifyWay('route=ferry')).toBe('?');
    expect(classifyWay('highway=something_new')).toBe('?');
  });
});

describe('surfacesFromMessages', () => {
  const header = [
    'Longitude',
    'Latitude',
    'Elevation',
    'Distance',
    'a',
    'b',
    'c',
    'd',
    'e',
    'WayTags',
  ];
  const row = (lon: number, lat: number, tags: string) => [
    String(Math.round(lon * 1e6)),
    String(Math.round(lat * 1e6)),
    '0',
    '10',
    '0',
    '0',
    '0',
    '0',
    '0',
    tags,
  ];
  const geometry = [
    [3.0, 45.0, 0],
    [3.001, 45.0, 0],
    [3.002, 45.0, 0],
    [3.003, 45.0, 0],
  ];

  it('gives one character per segment, from the way that ends at each place', () => {
    const messages = [
      header,
      row(3.002, 45.0, 'highway=residential surface=asphalt'),
      row(3.003, 45.0, 'highway=track'),
    ];
    expect(surfacesFromMessages(messages, geometry)).toBe('ppu');
  });

  it('is undefined when a place is not on the route, or the route stops short', () => {
    expect(
      surfacesFromMessages([header, row(3.5, 45.0, 'highway=track')], geometry),
    ).toBeUndefined();
    expect(
      surfacesFromMessages(
        [header, row(3.001, 45.0, 'highway=track')],
        geometry,
      ),
    ).toBeUndefined();
  });

  it('is undefined without messages', () => {
    expect(surfacesFromMessages(undefined, geometry)).toBeUndefined();
    expect(surfacesFromMessages([header], geometry)).toBeUndefined();
  });

  it('follows a place passed twice in order', () => {
    const loop = [
      [3.0, 45.0, 0],
      [3.001, 45.0, 0],
      [3.0, 45.0, 0],
    ];
    const messages = [
      header,
      row(3.001, 45.0, 'highway=track'),
      row(3.0, 45.0, 'highway=cycleway'),
    ];
    expect(surfacesFromMessages(messages, loop)).toBe('uc');
  });
});

describe('a recorded BRouter route', () => {
  const body = readFileSync(
    join(__dirname, '__fixtures__/brouter-surfaces.geojson'),
    'utf8',
  );

  it('has one category per segment, paved roads and cycleways included', () => {
    const route = parseGeoJson(body);
    expect(route.surfaces).toHaveLength(route.geometry.length - 1);
    expect(route.surfaces).toMatch(/^[pcus?]+$/);
    expect(route.surfaces).toContain('p');
    expect(route.surfaces).toContain('c');
  });
});
