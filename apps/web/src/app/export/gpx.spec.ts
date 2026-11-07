import { buildGpx, escapeXml, gpxFileName } from './gpx';

const route = {
  name: 'Col de la Ventouse',
  createdAt: Date.parse('2026-11-01T10:00:00Z'),
  points: [
    [3.087, 45.777],
    [3.15, 45.65],
    [3.249, 45.544],
  ] as [number, number][],
  geometry: [
    [3.087, 45.777, 402],
    [3.15, 45.65, 390.26],
    [3.2490004, 45.5440004, 380],
  ] as [number, number, number][],
};

describe('buildGpx', () => {
  const names = ['Start', 'Waypoint 1', 'End'];
  const xml = buildGpx(route, names);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const gpx = (selector: string) => Array.from(doc.querySelectorAll(selector));

  it('is well-formed XML with the GPX 1.1 namespace', () => {
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.localName).toBe('gpx');
    expect(doc.documentElement.getAttribute('version')).toBe('1.1');
    expect(doc.documentElement.getAttribute('creator')).toBe('Voie Libre');
    expect(doc.documentElement.namespaceURI).toBe(
      'http://www.topografix.com/GPX/1/1',
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('writes one track with one segment holding every point, in order', () => {
    expect(gpx('trk')).toHaveLength(1);
    expect(gpx('trkseg')).toHaveLength(1);
    const points = gpx('trkpt').map((p) => [
      p.getAttribute('lat'),
      p.getAttribute('lon'),
      p.querySelector('ele')?.textContent,
    ]);
    expect(points).toEqual([
      ['45.777000', '3.087000', '402.0'],
      ['45.650000', '3.150000', '390.3'],
      ['45.544000', '3.249000', '380.0'],
    ]);
  });

  it('puts latitude and longitude the right way round (GPX is lat, lon; geometry is lon, lat)', () => {
    const first = gpx('trkpt')[0];
    expect(Number(first.getAttribute('lat'))).toBeCloseTo(45.777);
    expect(Number(first.getAttribute('lon'))).toBeCloseTo(3.087);
  });

  it('writes a named waypoint for the start, each waypoint and the end, before the track', () => {
    expect(
      gpx('wpt').map((w) => [
        w.getAttribute('lat'),
        w.getAttribute('lon'),
        w.querySelector('name')?.textContent,
      ]),
    ).toEqual([
      ['45.777000', '3.087000', 'Start'],
      ['45.650000', '3.150000', 'Waypoint 1'],
      ['45.544000', '3.249000', 'End'],
    ]);
    // The GPX 1.1 schema requires wpt elements before trk.
    const order = Array.from(doc.documentElement.children).map(
      (c) => c.localName,
    );
    expect(order).toEqual(['metadata', 'wpt', 'wpt', 'wpt', 'trk']);
  });

  it('escapes waypoint names too', () => {
    const parsed = new DOMParser().parseFromString(
      buildGpx(route, ['A & <B>', '', 'End']),
      'application/xml',
    );
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('wpt > name')?.textContent).toBe('A & <B>');
  });

  it('names the track and the file, and dates it from the creation time', () => {
    expect(gpx('metadata > name')[0].textContent).toBe('Col de la Ventouse');
    expect(gpx('trk > name')[0].textContent).toBe('Col de la Ventouse');
    expect(gpx('metadata > time')[0].textContent).toBe(
      '2026-11-01T10:00:00.000Z',
    );
  });

  it('escapes markup and controls in the name', () => {
    const tricky = buildGpx(
      {
        ...route,
        name: `Tom & Jerry's <loop> "1"\u0001`,
      },
      names,
    );
    const parsed = new DOMParser().parseFromString(tricky, 'application/xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('trk > name')?.textContent).toBe(
      `Tom & Jerry's <loop> "1"`,
    );
  });

  it('keeps accents and other non-ASCII text as UTF-8', () => {
    expect(buildGpx({ ...route, name: 'Été à Clermont ✓' }, names)).toContain(
      '<name>Été à Clermont ✓</name>',
    );
  });

  it('handles an empty geometry', () => {
    const empty = new DOMParser().parseFromString(
      buildGpx({ ...route, geometry: [], points: [] }, []),
      'application/xml',
    );
    expect(empty.querySelector('parsererror')).toBeNull();
    expect(empty.querySelectorAll('trkpt')).toHaveLength(0);
  });
});

describe('escapeXml', () => {
  it('escapes the five XML characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('gpxFileName', () => {
  it.each([
    ['Col de la Ventouse', 'col-de-la-ventouse.gpx'],
    ['Été à Clermont', 'ete-a-clermont.gpx'],
    ['Road, 41 km', 'road-41-km.gpx'],
    ['  ../../etc/passwd  ', 'etc-passwd.gpx'],
    ['✓✓✓', 'route.gpx'],
    ['', 'route.gpx'],
  ])('turns %j into %s', (name, expected) => {
    expect(gpxFileName(name)).toBe(expected);
  });

  it('caps the length', () => {
    expect(gpxFileName('a'.repeat(200))).toHaveLength(60 + '.gpx'.length);
  });
});
