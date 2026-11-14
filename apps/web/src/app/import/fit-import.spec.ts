import { buildFit, fitCrc, type FitSource } from '../export/fit';
import { MAX_IMPORTED_POINTS } from './gpx-import';
import { FitImportError, MAX_FIT_BYTES, parseFit } from './fit-import';

// --- A small FIT writer for the cases our own export never produces (activities, big endian,
// --- compressed timestamps, developer fields): bytes laid out as the protocol says.

type Field = readonly [num: number, size: number, type: number];

const SINT32 = 0x85;
const UINT16 = 0x84;
const UINT32 = 0x86;
const ENUM = 0x00;

function int(value: number, size: number, little: boolean): number[] {
  const out: number[] = [];
  let rest = value < 0 ? value + 2 ** (8 * size) : value;
  for (let i = 0; i < size; i++) {
    out.push(rest % 256);
    rest = Math.floor(rest / 256);
  }
  return little ? out : out.reverse();
}

const semicircles = (degrees: number) => Math.round((degrees * 2 ** 31) / 180);

function definition(
  local: number,
  global: number,
  fields: readonly Field[],
  options: { big?: boolean; developer?: number[] } = {},
): number[] {
  const little = !options.big;
  const developer = options.developer;
  return [
    0x40 | (developer ? 0x20 : 0) | local,
    0,
    little ? 0 : 1,
    ...int(global, 2, little),
    fields.length,
    ...fields.flatMap(([num, size, type]) => [num, size, type]),
    ...(developer ? [1, developer[0], developer[1], 0] : []),
  ];
}

function file(messages: number[][], options: { headerSize?: 12 | 14 } = {}) {
  const headerSize = options.headerSize ?? 14;
  const body = messages.flat();
  const header = [
    headerSize,
    0x20,
    ...int(2100, 2, true),
    ...int(body.length, 4, true),
    0x2e, // .FIT
    0x46,
    0x49,
    0x54,
    ...(headerSize === 14 ? [0, 0] : []),
  ];
  const crc = fitCrc(Uint8Array.from([...header, ...body]));
  return Uint8Array.from([...header, ...body, ...int(crc, 2, true)]);
}

const RECORD_POSITION: Field[] = [
  [253, 4, UINT32],
  [0, 4, SINT32],
  [1, 4, SINT32],
];

const record = (
  local: number,
  time: number,
  lat: number,
  lon: number,
  big = false,
  extra: number[] = [],
) => [
  local,
  ...int(time, 4, !big),
  ...int(semicircles(lat), 4, !big),
  ...int(semicircles(lon), 4, !big),
  ...extra,
];

// --- Our own course files, read back.

const source = (overrides: Partial<FitSource> = {}): FitSource => ({
  name: 'Clermont to Issoire',
  profile: 'road',
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  geometry: [
    [3.087, 45.777, 402],
    [3.12, 45.7, 380],
    [3.18, 45.62, 450],
    [3.249, 45.544, 391],
  ],
  createdAt: Date.UTC(2026, 10, 14, 8, 0, 0),
  distanceMeters: 41_000,
  ascentMeters: 140,
  durationSeconds: 5400,
  ...overrides,
});

describe('parseFit', () => {
  describe('a course made by buildFit', () => {
    it('gives the route back: its name, its track, its altitudes, its duration', () => {
      const route = source();
      const imported = parseFit(buildFit(route), 'road');
      expect(imported.name).toBe('Clermont to Issoire');
      expect(imported.geometry).toHaveLength(4);
      imported.geometry.forEach(([lon, lat, ele], i) => {
        expect(lon).toBeCloseTo(route.geometry[i][0], 5);
        expect(lat).toBeCloseTo(route.geometry[i][1], 5);
        expect(ele).toBeCloseTo(route.geometry[i][2], 0);
      });
      expect(imported.points).toEqual([
        [imported.geometry[0][0], imported.geometry[0][1]],
        [imported.geometry[3][0], imported.geometry[3][1]],
      ]);
      expect(imported.durationSeconds).toBe(5400);
      // 380 → 450 is the only climb over 3 m; 402 → 380 and 450 → 391 are descents.
      expect(imported.ascentMeters).toBe(70);
      expect(imported.thinned).toBe(false);
    });

    it('has no climb when the course has no altitude', () => {
      const imported = parseFit(
        buildFit(source({ ascentMeters: null })),
        'road',
      );
      expect(imported.ascentMeters).toBeNull();
      expect(imported.geometry.every((p) => p[2] === 0)).toBe(true);
    });

    it('reads a loop done twice as the two laps one after the other', () => {
      const route = source({
        geometry: [
          [3.087, 45.777, 400],
          [3.15, 45.65, 420],
          [3.087, 45.777, 400],
        ],
      });
      const once = parseFit(buildFit(route), 'road');
      const twice = parseFit(buildFit(route, [], 2), 'road');
      // The end of a lap is the start of the next: that place is written once.
      expect(once.geometry).toHaveLength(3);
      expect(twice.geometry).toHaveLength(5);
      expect(twice.distanceMeters / once.distanceMeters).toBeCloseTo(2, 1);
    });
  });

  describe('an activity written by a device', () => {
    const activity = (big: boolean) => {
      const altitudeFields: Field[] = [...RECORD_POSITION, [78, 4, UINT32]];
      const enhanced = (meters: number) =>
        int(Math.round((meters + 500) * 5), 4, !big);
      return file([
        definition(0, 0, [[0, 1, ENUM]], { big }),
        [0, 4], // file type: activity
        definition(1, 20, altitudeFields, { big }),
        record(1, 1000, 45.0, 3.0, big, enhanced(100)),
        record(1, 1001, 45.001, 3.0, big, enhanced(110)),
        record(1, 1002, 45.002, 3.0, big, enhanced(120)),
        record(1, 1003, 45.003, 3.0, big, enhanced(130)),
        definition(2, 18, [[8, 4, UINT32]], { big }),
        [2, ...int(1_800_000, 4, !big)], // 30 minutes of timer time
      ]);
    };

    it.each([
      ['little endian', false],
      ['big endian', true],
    ])('reads the records and the timer time, %s', (_label, big) => {
      const imported = parseFit(activity(big), 'road');
      expect(imported.geometry).toHaveLength(4);
      expect(imported.geometry[3][1]).toBeCloseTo(45.003, 5);
      expect(imported.geometry.map((p) => Math.round(p[2]))).toEqual([
        100, 110, 120, 130,
      ]);
      // The timer time of the session, not the three seconds between the records.
      expect(imported.durationSeconds).toBe(1800);
      expect(imported.name).toBeNull();
      expect(imported.ascentMeters).toBe(30);
    });

    it('skips records without a position, and takes the altitude field when there is no enhanced one', () => {
      const fields: Field[] = [...RECORD_POSITION, [2, 2, UINT16]];
      const altitude = (meters: number) =>
        int(Math.round((meters + 500) * 5), 2, true);
      const imported = parseFit(
        file([
          definition(0, 20, fields),
          record(0, 1, 45.0, 3.0, false, altitude(200)),
          // 0x7FFFFFFF is "no value" for a latitude: a record from a tunnel.
          [
            0,
            ...int(2, 4, true),
            ...int(0x7fffffff, 4, true),
            ...int(0x7fffffff, 4, true),
            ...altitude(0),
          ],
          record(0, 3, 45.002, 3.0, false, altitude(230)),
        ]),
        'road',
      );
      expect(imported.geometry).toHaveLength(2);
      expect(Math.round(imported.geometry[1][2])).toBe(230);
    });

    it('reads data messages with a compressed timestamp header, and skips developer fields', () => {
      const positionOnly: Field[] = [
        [0, 4, SINT32],
        [1, 4, SINT32],
      ];
      const imported = parseFit(
        file([
          // Developer fields: 2 bytes more in each message of this definition.
          definition(0, 20, RECORD_POSITION, { developer: [7, 2] }),
          [...record(0, 1, 45.0, 3.0), 0xaa, 0xbb],
          [...record(0, 2, 45.001, 3.0), 0xaa, 0xbb],
          // A message that carries its time in its header has no timestamp field: its header has
          // bit 7 set, its local type in bits 5 and 6 and a time offset in bits 0 to 4.
          definition(1, 20, positionOnly),
          [
            0x80 | (1 << 5) | 3,
            ...int(semicircles(45.002), 4, true),
            ...int(semicircles(3.0), 4, true),
          ],
        ]),
        'road',
      );
      expect(imported.geometry).toHaveLength(3);
      expect(imported.geometry[2][1]).toBeCloseTo(45.002, 5);
    });

    it('thins a very long track to the most the API takes, and says so', () => {
      const count = MAX_IMPORTED_POINTS + 1000;
      const messages = [definition(0, 20, RECORD_POSITION)];
      for (let i = 0; i < count; i++) {
        messages.push(record(0, i, 45 + i * 1e-5, 3 + i * 1e-5));
      }
      const imported = parseFit(file(messages), 'road');
      expect(imported.geometry).toHaveLength(MAX_IMPORTED_POINTS);
      expect(imported.thinned).toBe(true);
    });

    it('gives the climb unknown when most records have no altitude, and fills a few gaps', () => {
      const fields: Field[] = [...RECORD_POSITION, [2, 2, UINT16]];
      const altitude = (meters: number) =>
        int(Math.round((meters + 500) * 5), 2, true);
      const none = int(0xffff, 2, true);
      const make = (gaps: number, total: number) => {
        const messages = [definition(0, 20, fields)];
        for (let i = 0; i < total; i++) {
          messages.push(
            record(
              0,
              i,
              45 + i * 1e-4,
              3,
              false,
              i < gaps ? none : altitude(100 + i * 5),
            ),
          );
        }
        return parseFit(file(messages), 'road');
      };
      // One record in twenty lacks it: the last known altitude stands in.
      expect(make(1, 20).ascentMeters).not.toBeNull();
      // Half of them: no climb.
      expect(make(10, 20).ascentMeters).toBeNull();
    });
  });

  describe('files in a row', () => {
    it('reads each one and joins their records', () => {
      const first = buildFit(source());
      const second = buildFit(
        source({
          geometry: [
            [3.3, 45.5, 400],
            [3.35, 45.45, 420],
          ],
        }),
      );
      const joined = Uint8Array.from([...first, ...second]);
      expect(parseFit(joined, 'road').geometry).toHaveLength(4 + 2);
    });
  });

  describe('files that cannot be read', () => {
    it('refuses what is not a FIT file', () => {
      expect(() =>
        parseFit(
          new TextEncoder().encode('hello world, this is not it'),
          'road',
        ),
      ).toThrow(FitImportError);
      try {
        parseFit(
          new TextEncoder().encode('hello world, this is not it'),
          'road',
        );
      } catch (error) {
        expect((error as FitImportError).code).toBe('invalid_file');
      }
    });

    it('refuses a file cut short', () => {
      const bytes = buildFit(source());
      expect(() =>
        parseFit(bytes.subarray(0, bytes.length - 40), 'road'),
      ).toThrow(expect.objectContaining({ code: 'invalid_file' }));
    });

    it('refuses data that comes before its definition', () => {
      expect(() => parseFit(file([record(0, 1, 45, 3)]), 'road')).toThrow(
        expect.objectContaining({ code: 'invalid_file' }),
      );
    });

    it('says there is no track in a file without positions', () => {
      const bytes = file([
        definition(0, 0, [[0, 1, ENUM]]),
        [0, 5], // a workout
      ]);
      expect(() => parseFit(bytes, 'road')).toThrow(
        expect.objectContaining({ code: 'no_track' }),
      );
    });

    it('says a single point is too short', () => {
      const bytes = file([
        definition(0, 20, RECORD_POSITION),
        record(0, 1, 45, 3),
      ]);
      expect(() => parseFit(bytes, 'road')).toThrow(
        expect.objectContaining({ code: 'too_short' }),
      );
    });

    it('says a file is too large before reading it', () => {
      expect(() => parseFit(new Uint8Array(MAX_FIT_BYTES + 1), 'road')).toThrow(
        expect.objectContaining({ code: 'too_large' }),
      );
    });
  });

  it('reads the name of a course as UTF-8', () => {
    const route = source({ name: 'Col de la Ventouse, é' });
    expect(parseFit(buildFit(route), 'road').name).toBe(
      'Col de la Ventouse, é',
    );
  });

  it('reads a file with the 12-byte header of the early protocol', () => {
    const bytes = file(
      [
        definition(0, 20, RECORD_POSITION),
        record(0, 1, 45, 3),
        record(0, 2, 45.001, 3),
      ],
      { headerSize: 12 },
    );
    expect(parseFit(bytes, 'road').geometry).toHaveLength(2);
  });
});
