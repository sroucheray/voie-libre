import {
  GPX_LANGUAGES,
  buildGpx,
  escapeXml,
  gpxFileName,
  gpxPointNames,
} from './gpx';
import { ROUTE_ID_ALPHABET, ROUTE_ID_PATTERN } from './route-id';

const route = {
  name: 'Col de la Ventouse',
  createdAt: Date.parse('2026-11-01T10:00:00Z'),
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ] as [number, number][],
  geometry: [
    [3.087, 45.777, 402],
    [3.249, 45.544, 380.26],
  ] as [number, number, number][],
};

describe('buildGpx (shared by the web app and the API)', () => {
  it('writes the waypoints before the track, latitude first', () => {
    const xml = buildGpx(route, ['Start', 'End']);
    expect(xml).toContain(
      '<wpt lat="45.777000" lon="3.087000"><name>Start</name></wpt>',
    );
    expect(xml).toContain(
      '<trkpt lat="45.544000" lon="3.249000"><ele>380.3</ele></trkpt>',
    );
    expect(xml.indexOf('<wpt')).toBeLessThan(xml.indexOf('<trk>'));
    expect(xml).toContain('<time>2026-11-01T10:00:00.000Z</time>');
  });

  it('escapes markup in names', () => {
    expect(buildGpx({ ...route, name: 'A & <B>' }, ['<', '&'])).toContain(
      '<name>A &amp; &lt;B&gt;</name>',
    );
    expect(escapeXml('\u0001ok')).toBe('ok');
  });
});

describe('gpxFileName', () => {
  it('makes a safe ASCII name', () => {
    expect(gpxFileName('Été à Clermont')).toBe('ete-a-clermont.gpx');
    expect(gpxFileName('../../x')).toBe('x.gpx');
    expect(gpxFileName('')).toBe('route.gpx');
  });
});

describe('gpxPointNames', () => {
  it('names the start, the waypoints and the end', () => {
    expect(gpxPointNames('en', 4)).toEqual([
      'Start',
      'Waypoint 1',
      'Waypoint 2',
      'End',
    ]);
    expect(gpxPointNames('fr', 3)).toEqual(['Départ', 'Étape 1', 'Arrivée']);
    expect(gpxPointNames('en', 0)).toEqual([]);
  });

  it('supports the languages the web app ships', () => {
    expect(GPX_LANGUAGES).toEqual(['en', 'fr']);
  });
});

describe('ROUTE_ID_PATTERN', () => {
  const pattern = new RegExp(ROUTE_ID_PATTERN);

  it('accepts 8 to 10 characters of the alphabet', () => {
    expect(pattern.test('abcdefgh')).toBe(true);
    expect(pattern.test('abcdefghjk')).toBe(true);
    expect(ROUTE_ID_ALPHABET).toHaveLength(32);
  });

  it.each([
    'abcdefg',
    'abcdefghjkm',
    'abcdefg0',
    'abcdefgl',
    'ABCDEFGH',
    'abcdefg/',
    '../etc/pw',
  ])('rejects %s', (id) => {
    expect(pattern.test(id)).toBe(false);
  });
});
