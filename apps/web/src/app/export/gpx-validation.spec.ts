import { gpx as gpxToGeoJson } from '@tmcw/togeojson';
import { validateXML } from 'xmllint-wasm';
import { GPX_1_1_SCHEMA as schema } from '../../testing/fixtures/gpx-1.1-schema';
import { buildGpx } from './gpx';

const route = {
  name: 'Été & "Ventouse" <test>',
  createdAt: Date.parse('2026-11-01T10:00:00Z'),
  points: [
    [3.087, 45.777],
    [3.15, 45.65],
    [3.249, 45.544],
  ] as [number, number][],
  geometry: [
    [3.087, 45.777, 402],
    [3.1, 45.7, 398.4],
    [3.15, 45.65, 390.26],
    [3.249, 45.544, 380],
  ] as [number, number, number][],
};
const names = ['Start', 'Waypoint 1', 'End'];

describe('GPX output against the official schema and a real parser', () => {
  it('validates against the GPX 1.1 schema from Topografix', async () => {
    const result = await validateXML({
      xml: [{ fileName: 'route.gpx', contents: buildGpx(route, names) }],
      schema: [{ fileName: 'gpx.xsd', contents: schema }],
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('is rejected by the schema when a waypoint comes after the track (sanity check)', async () => {
    const gpx = buildGpx(route, names);
    const broken = gpx.replace(
      /( {2}<wpt[^]*?<\/wpt>\n)( {2}<trk>[^]*<\/trk>\n)/,
      '$2$1',
    );
    expect(broken).not.toBe(gpx);
    const result = await validateXML({
      xml: [{ fileName: 'broken.gpx', contents: broken }],
      schema: [{ fileName: 'gpx.xsd', contents: schema }],
    });
    expect(result.valid).toBe(false);
  });

  it('is read back by a GPX parser as the same track and waypoints', () => {
    const doc = new DOMParser().parseFromString(
      buildGpx(route, names),
      'application/xml',
    );
    const { features } = gpxToGeoJson(doc);
    const line = features.find((f) => f.geometry.type === 'LineString')!;
    expect(line.properties?.['name']).toBe('Été & "Ventouse" <test>');
    expect((line.geometry as { coordinates: number[][] }).coordinates).toEqual([
      [3.087, 45.777, 402],
      [3.1, 45.7, 398.4],
      [3.15, 45.65, 390.3],
      [3.249, 45.544, 380],
    ]);
    const points = features.filter((f) => f.geometry.type === 'Point');
    expect(points.map((p) => p.properties?.['name'])).toEqual(names);
    expect(
      points.map((p) => (p.geometry as { coordinates: number[] }).coordinates),
    ).toEqual(route.points);
  });
});
