import FitParser from 'fit-file-parser';
import { buildFit, fitCrc, fitFileName, type FitSource } from './fit';

const route: FitSource = {
  name: 'Col de la Ventouse',
  profile: 'road',
  createdAt: Date.parse('2026-11-01T10:00:00Z'),
  points: [
    [3.087, 45.777],
    [3.15, 45.65],
    [3.249, 45.544],
  ],
  geometry: [
    [3.087, 45.777, 402],
    [3.12, 45.71, 455.4],
    [3.15, 45.65, 390.2],
    [3.2490004, 45.5440004, -12],
  ],
  distanceMeters: 30_000,
  ascentMeters: 620,
  durationSeconds: 5400,
};

/** Reads the file back with an independent decoder, checking its CRCs and its structure. */
async function parse(file: Uint8Array) {
  const parser = new FitParser({ force: false, strict: true });
  const buffer = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;
  return (await parser.parseAsync(buffer)) as unknown as Record<
    string,
    Record<string, unknown>[] & Record<string, unknown>
  >;
}

/** The parser gives the course alone or in a list, depending on its mode. */
function courseOf(fit: Awaited<ReturnType<typeof parse>>) {
  return [fit['course']].flat()[0] as Record<string, unknown>;
}

describe('buildFit', () => {
  it('writes a 14-byte header with the data size and both CRCs', () => {
    const file = buildFit(route);
    const view = new DataView(file.buffer);
    expect(file[0]).toBe(14);
    expect(String.fromCharCode(...file.subarray(8, 12))).toBe('.FIT');
    expect(view.getUint32(4, true)).toBe(file.length - 16);
    expect(view.getUint16(12, true)).toBe(fitCrc(file.subarray(0, 12)));
    expect(view.getUint16(file.length - 2, true)).toBe(
      fitCrc(file.subarray(0, file.length - 2)),
    );
    // The CRC of a file with its own CRC at the end is zero.
    expect(fitCrc(file)).toBe(0);
  });

  it('is read back as a cycling course with its lap, records and course points', async () => {
    const fit = await parse(buildFit(route, ['Étape 1']));

    expect(fit['file_ids'][0]['type']).toBe('course');
    expect(courseOf(fit)['name']).toBe('Col de la Ventouse');
    expect(courseOf(fit)['sport']).toBe('cycling');

    const [lap] = fit['laps'];
    expect(lap['total_distance']).toBeCloseTo(30_000, 1);
    expect(lap['total_ascent']).toBe(620);
    expect(lap['total_timer_time']).toBeCloseTo(5400, 1);
    expect(lap['start_time']).toEqual(new Date('2026-11-01T10:00:00Z'));

    const records = fit['records'];
    expect(records).toHaveLength(4);
    expect(records[0]['position_lat']).toBeCloseTo(45.777, 5);
    expect(records[0]['position_long']).toBeCloseTo(3.087, 5);
    expect(records[0]['altitude']).toBeCloseTo(402, 1);
    expect(records[0]['distance']).toBe(0);
    expect(records[0]['timestamp']).toEqual(new Date('2026-11-01T10:00:00Z'));
    expect(records[1]['altitude']).toBeCloseTo(455.4, 1);
    expect(records[3]['position_lat']).toBeCloseTo(45.5440004, 5);
    expect(records[3]['position_long']).toBeCloseTo(3.2490004, 5);
    expect(records[3]['altitude']).toBeCloseTo(-12, 1);
    expect(records[3]['distance']).toBeCloseTo(30_000, 1);
    expect(records[3]['timestamp']).toEqual(new Date('2026-11-01T11:30:00Z'));
    // Distances and times only grow.
    for (let i = 1; i < records.length; i++) {
      expect(records[i]['distance']).toBeGreaterThan(
        records[i - 1]['distance'] as number,
      );
    }

    const points = fit['course_points'];
    expect(points).toHaveLength(1);
    expect(points[0]['name']).toBe('Étape 1');
    expect(points[0]['position_lat']).toBeCloseTo(45.65, 5);
    expect(points[0]['position_long']).toBeCloseTo(3.15, 5);
    expect(points[0]['distance']).toBe(records[2]['distance']);
  });

  it('is a running course on the trail profile', async () => {
    const fit = await parse(buildFit({ ...route, profile: 'trail' }));
    expect(courseOf(fit)['sport']).toBe('running');
  });

  it('writes no altitude and no climb when the elevations are unknown', async () => {
    const fit = await parse(buildFit({ ...route, ascentMeters: null }));
    expect(fit['records']).toHaveLength(4);
    expect(fit['records'][0]['altitude']).toBeUndefined();
    expect(fit['laps'][0]['total_ascent']).toBeUndefined();
  });

  it('cuts a long name between two characters', async () => {
    const name = 'Étape très élevée '.repeat(6);
    const fit = await parse(buildFit({ ...route, name }));
    const read = courseOf(fit)['name'] as string;
    expect(name.startsWith(read)).toBe(true);
    expect(new TextEncoder().encode(read).length).toBeLessThanOrEqual(47);
    expect(read.length).toBeGreaterThan(30);
  });

  it('refuses a route without a line', () => {
    expect(() =>
      buildFit({ ...route, geometry: [route.geometry[0]] }),
    ).toThrow();
  });
});

describe('fitFileName', () => {
  it('makes a safe file name ending in .fit', () => {
    expect(fitFileName('Col de la Ventouse')).toBe('col-de-la-ventouse.fit');
    expect(fitFileName('')).toBe('route.fit');
  });
});
