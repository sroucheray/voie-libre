import { buildGpx } from '@voie-libre/shared';
import {
  GpxImportError,
  MAX_GPX_CHARACTERS,
  MAX_IMPORTED_POINTS,
  climbOf,
  parseGpx,
} from './gpx-import';

const gpx = (body: string) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

const trkpt = (lat: number, lon: number, ele?: number) =>
  `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;

const track = (points: string, name = '') =>
  gpx(`<trk>${name && `<name>${name}</name>`}<trkseg>${points}</trkseg></trk>`);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as GpxImportError).code;
  }
  return null;
};

describe('parseGpx', () => {
  const sample = track(
    trkpt(45, 3, 100) + trkpt(45.001, 3, 120) + trkpt(45.002, 3, 150),
    'Morning ride',
  );

  it('reads a track: geometry, name, ends, distance and climb', () => {
    const route = parseGpx(sample, 'road');
    expect(route.name).toBe('Morning ride');
    expect(route.geometry).toEqual([
      [3, 45, 100],
      [3, 45.001, 120],
      [3, 45.002, 150],
    ]);
    expect(route.points).toEqual([
      [3, 45],
      [3, 45.002],
    ]);
    expect(route.distanceMeters).toBeGreaterThan(220);
    expect(route.distanceMeters).toBeLessThan(225);
    expect(route.ascentMeters).toBe(50);
    expect(route.durationSeconds).toBeGreaterThan(0);
    expect(route.thinned).toBe(false);
  });

  it('joins the segments of the first track and ignores the others', () => {
    const text = gpx(
      `<trk><trkseg>${trkpt(45, 3, 1)}${trkpt(45.001, 3, 2)}</trkseg>` +
        `<trkseg>${trkpt(45.002, 3, 3)}</trkseg></trk>` +
        `<trk><trkseg>${trkpt(10, 10, 0)}${trkpt(10.1, 10, 0)}</trkseg></trk>`,
    );
    expect(parseGpx(text, 'road').geometry).toHaveLength(3);
  });

  it('falls back to a route (<rte>) and keeps its points as via points', () => {
    const text = gpx(
      `<rte><name>Planned</name>` +
        `<rtept lat="45" lon="3"><ele>10</ele></rtept>` +
        `<rtept lat="45.001" lon="3"><ele>20</ele></rtept>` +
        `<rtept lat="45.002" lon="3"><ele>30</ele></rtept></rte>`,
    );
    const route = parseGpx(text, 'gravel');
    expect(route.name).toBe('Planned');
    expect(route.points).toHaveLength(3);
  });

  it('prefers the track when the file has both', () => {
    const text = gpx(
      `<rte><rtept lat="1" lon="1"/><rtept lat="2" lon="2"/></rte>` +
        `<trk><trkseg>${trkpt(45, 3, 1)}${trkpt(45.001, 3, 2)}</trkseg></trk>`,
    );
    expect(parseGpx(text, 'road').geometry[0]).toEqual([3, 45, 1]);
  });

  it('imports without elevation: unknown climb, zero elevations', () => {
    const route = parseGpx(track(trkpt(45, 3) + trkpt(45.001, 3)), 'road');
    expect(route.ascentMeters).toBeNull();
    expect(route.geometry.every((p) => p[2] === 0)).toBe(true);
  });

  it('treats a partly missing elevation as unknown', () => {
    const route = parseGpx(track(trkpt(45, 3, 5) + trkpt(45.001, 3)), 'road');
    expect(route.ascentMeters).toBeNull();
  });

  it('skips points with a bad position', () => {
    const text = track(trkpt(45, 3, 1) + trkpt(95, 3, 1) + trkpt(45.001, 3, 2));
    expect(parseGpx(text, 'road').geometry).toHaveLength(2);
  });

  it('thins very long tracks, keeping both ends', () => {
    const points = Array.from({ length: 20000 }, (_, i) =>
      trkpt(45 + i * 0.00001, 3, 100),
    ).join('');
    const route = parseGpx(track(points), 'road');
    expect(route.geometry).toHaveLength(MAX_IMPORTED_POINTS);
    expect(route.geometry[0][1]).toBe(45);
    expect(route.geometry.at(-1)![1]).toBeCloseTo(45.19999, 5);
    expect(route.thinned).toBe(true);
  });

  it('refuses files it cannot use, with a code', () => {
    expect(code(() => parseGpx('not xml', 'road'))).toBe('invalid_file');
    expect(code(() => parseGpx('<html/>', 'road'))).toBe('invalid_file');
    expect(code(() => parseGpx(gpx('<wpt lat="1" lon="1"/>'), 'road'))).toBe(
      'no_track',
    );
    expect(code(() => parseGpx(track(trkpt(45, 3, 1)), 'road'))).toBe(
      'too_short',
    );
    expect(
      code(() => parseGpx(track(trkpt(45, 3) + trkpt(45, 3)), 'road')),
    ).toBe('too_short');
    expect(
      code(() => parseGpx('x'.repeat(MAX_GPX_CHARACTERS + 1), 'road')),
    ).toBe('too_large');
  });

  it('reads back what buildGpx writes', () => {
    const geometry: [number, number, number][] = [
      [3.087, 45.777, 402.5],
      [3.15, 45.65, 390],
      [3.249, 45.544, 380],
    ];
    const text = buildGpx(
      {
        name: 'A to B',
        points: [
          [3.087, 45.777],
          [3.249, 45.544],
        ],
        geometry,
        createdAt: 0,
      },
      ['Start', 'End'],
    );
    const route = parseGpx(text, 'road');
    expect(route.name).toBe('A to B');
    expect(route.geometry).toEqual(geometry.map(([a, b, c]) => [a, b, c]));
  });
});

describe('climbOf', () => {
  it('ignores wobbles under the threshold and counts real climbs', () => {
    expect(climbOf([100, 101, 100, 102, 100])).toBe(0);
    expect(climbOf([100, 110, 105, 120])).toBe(25);
    expect(climbOf([120, 100, 80])).toBe(0);
    expect(climbOf([])).toBe(0);
  });
});
