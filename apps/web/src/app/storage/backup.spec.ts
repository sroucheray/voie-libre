import {
  BACKUP_VERSION,
  backupFileName,
  backupKey,
  buildBackup,
  parseBackup,
} from './backup';
import type { SavedRoute } from './saved-route';

const route = (patch: Partial<SavedRoute> = {}): SavedRoute => ({
  schemaVersion: 1,
  id: 'abcdefghjk',
  name: 'Clermont → Issoire',
  profile: 'gravel',
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  geometry: [
    [3.087, 45.777, 402],
    [3.15, 45.65, 390],
    [3.249, 45.544, 380],
  ],
  distanceMeters: 41007,
  ascentMeters: 399,
  durationSeconds: 8674,
  elevationSource: 'copernicus',
  surfaces: 'pu',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  ...patch,
});

const date = new Date('2026-11-14T10:00:00Z');
const parse = (routes: SavedRoute[]) => parseBackup(buildBackup(routes, date));

describe('backup', () => {
  it('names the file after the day', () => {
    expect(backupFileName(date)).toBe('voie-libre-routes-2026-11-14.json');
  });

  it('round-trips routes with a loop, laps and an unknown climb', () => {
    const routes = [
      route(),
      route({
        name: 'Loop',
        points: [
          [3, 45],
          [3, 45],
        ],
        loop: { mode: 'distance', distanceMeters: 30000, direction: 'ne' },
        laps: 3,
        ascentMeters: null,
        elevationSource: undefined,
        surfaces: undefined,
      }),
    ];
    const result = parse(routes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes[0]).toMatchObject({
      name: 'Clermont → Issoire',
      elevationSource: 'copernicus',
      surfaces: 'pu',
    });
    expect(result.routes[1]).toMatchObject({
      loop: { mode: 'distance', distanceMeters: 30000, direction: 'ne' },
      laps: 3,
      ascentMeters: null,
    });
  });

  it('never writes the id, the dates or the delete token of a shared route', () => {
    const text = buildBackup(
      [route({ share: { deleteToken: 'secret-token', sharedAt: 1 } })],
      date,
    );
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('abcdefghjk');
    expect(text).not.toContain('createdAt');
    expect(JSON.parse(text).version).toBe(BACKUP_VERSION);
  });

  it('accepts an empty list', () => {
    expect(parse([])).toEqual({ ok: true, routes: [] });
  });

  describe('refuses', () => {
    const file = (patch: object) =>
      JSON.stringify({ ...JSON.parse(buildBackup([route()], date)), ...patch });
    const withRoute = (patch: object) =>
      file({
        routes: [
          { ...JSON.parse(buildBackup([route()], date)).routes[0], ...patch },
        ],
      });

    it.each([
      ['text that is not JSON', 'hello', 'not_a_backup'],
      ['JSON of another kind', '{"kind":"gpx"}', 'not_a_backup'],
      ['a list', '[]', 'not_a_backup'],
      [
        'a newer version',
        file({ version: BACKUP_VERSION + 1 }),
        'newer_version',
      ],
      ['a missing version', file({ version: undefined }), 'invalid'],
      ['routes that are not a list', file({ routes: {} }), 'invalid'],
      ['an unknown profile', withRoute({ profile: 'boat' }), 'invalid'],
      ['a single point', withRoute({ points: [[3, 45]] }), 'invalid'],
      [
        'a point out of range',
        withRoute({
          points: [
            [300, 45],
            [3, 45],
          ],
        }),
        'invalid',
      ],
      [
        'too many points',
        withRoute({ points: Array.from({ length: 21 }, () => [3, 45]) }),
        'invalid',
      ],
      [
        'a geometry point with no elevation',
        withRoute({
          geometry: [
            [3, 45],
            [3, 46],
          ],
        }),
        'invalid',
      ],
      ['a negative distance', withRoute({ distanceMeters: -1 }), 'invalid'],
      ['surfaces of the wrong length', withRoute({ surfaces: 'p' }), 'invalid'],
      [
        'surfaces with other characters',
        withRoute({ surfaces: 'x!' }),
        'invalid',
      ],
      [
        'an unknown elevation source',
        withRoute({ elevationSource: 'bing' }),
        'invalid',
      ],
      [
        'a loop mode out of bounds',
        withRoute({ loop: { mode: 'distance', distanceMeters: 5 } }),
        'invalid',
      ],
      ['laps out of bounds', withRoute({ laps: 99 }), 'invalid'],
      ['an empty name', withRoute({ name: '' }), 'invalid'],
    ])('%s', (_label, text, code) => {
      expect(parseBackup(text)).toEqual({ ok: false, code });
    });

    it('the whole file when only one route is damaged', () => {
      const good = JSON.parse(buildBackup([route()], date)).routes[0];
      const text = JSON.stringify({
        kind: 'voie-libre-routes',
        version: 1,
        routes: [good, { ...good, profile: 'boat' }],
      });
      expect(parseBackup(text)).toEqual({ ok: false, code: 'invalid' });
    });
  });

  it('recognises the same route by name, profile, points and length', () => {
    const a = route();
    expect(backupKey(a)).toBe(backupKey(route({ id: 'other', createdAt: 5 })));
    expect(backupKey(a)).not.toBe(backupKey(route({ name: 'Other' })));
    expect(backupKey(a)).not.toBe(backupKey(route({ profile: 'road' })));
  });
});
