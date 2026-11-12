import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbRouteStore } from './indexeddb-route-store';
import { RouteStoreError } from './route-store';
import { NewSavedRoute, SAVED_ROUTE_SCHEMA_VERSION } from './saved-route';

const route = (name: string): NewSavedRoute => ({
  name,
  profile: 'gravel',
  points: [
    [3.087, 45.777],
    [3.15, 45.65],
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
});

async function rejection(promise: Promise<unknown>): Promise<RouteStoreError> {
  try {
    await promise;
  } catch (error) {
    return error as RouteStoreError;
  }
  throw new Error('expected a rejection');
}

describe('IndexedDbRouteStore', () => {
  let store: IndexedDbRouteStore;

  beforeEach(() => {
    // Only Date is faked: fake-indexeddb needs the real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    const factory = new IDBFactory();
    store = new IndexedDbRouteStore(() => factory);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a route with a short id, the dates and the schema version', async () => {
    const saved = await store.save(route('Puy de Dôme'));
    expect(saved).toEqual({
      ...route('Puy de Dôme'),
      id: expect.stringMatching(/^[a-z2-9]{10}$/),
      schemaVersion: SAVED_ROUTE_SCHEMA_VERSION,
      createdAt: Date.parse('2026-11-01T10:00:00Z'),
      updatedAt: Date.parse('2026-11-01T10:00:00Z'),
    });
  });

  it('opens a saved route exactly as it was saved', async () => {
    const saved = await store.save(route('A'));
    expect(await store.get(saved.id)).toEqual(saved);
  });

  it('survives a new store on the same database (a page reload)', async () => {
    const factory = new IDBFactory();
    const saved = await new IndexedDbRouteStore(() => factory).save(route('A'));
    const reloaded = new IndexedDbRouteStore(() => factory);
    expect(await reloaded.list()).toEqual([saved]);
  });

  it('lists routes from the most recent to the oldest', async () => {
    const first = await store.save(route('first'));
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    const second = await store.save(route('second'));
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    const third = await store.save(route('third'));
    const names = (await store.list()).map((r) => r.name);
    expect(names).toEqual(['third', 'second', 'first']);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it('lists nothing when empty', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('renames a route and updates its modification date only', async () => {
    const saved = await store.save(route('old'));
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const renamed = await store.rename(saved.id, 'new');
    expect(renamed).toEqual({
      ...saved,
      name: 'new',
      updatedAt: Date.parse('2026-11-05T10:00:00Z'),
    });
    expect(await store.get(saved.id)).toEqual(renamed);
  });

  it('remembers that a route is shared, and forgets it', async () => {
    const saved = await store.save(route('A'));
    const shared = await store.setShare(saved.id, {
      deleteToken: 'secret',
      sharedAt: 5,
    });
    expect(shared.share).toEqual({ deleteToken: 'secret', sharedAt: 5 });
    expect((await store.get(saved.id))?.share?.deleteToken).toBe('secret');
    // Sharing does not touch the rest of the record, nor the modification date.
    expect({ ...shared, share: undefined }).toEqual({
      ...saved,
      share: undefined,
    });
    const unshared = await store.setShare(saved.id, null);
    expect('share' in unshared).toBe(false);
    expect('share' in ((await store.get(saved.id)) ?? {})).toBe(false);
  });

  it('remembers how many laps of a loop an export holds, and forgets it for one', async () => {
    const saved = await store.save(route('A'));
    expect('laps' in saved).toBe(false);
    const lapped = await store.setLaps(saved.id, 3);
    expect(lapped.laps).toBe(3);
    expect((await store.get(saved.id))?.laps).toBe(3);
    // Only the laps change, not the modification date.
    expect({ ...lapped, laps: undefined }).toEqual({
      ...saved,
      laps: undefined,
    });
    const once = await store.setLaps(saved.id, 1);
    expect('laps' in once).toBe(false);
    await expect(store.setLaps('missing', 2)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('replaces the geometry and the climb, keeping everything else', async () => {
    const saved = await store.save({ ...route('A'), ascentMeters: null });
    const geometry: [number, number, number][] = [
      [3, 45, 100],
      [3, 45.01, 160],
    ];
    const updated = await store.setElevation(saved.id, geometry, 60);
    expect(updated.geometry).toEqual(geometry);
    expect(updated.ascentMeters).toBe(60);
    expect(updated.name).toBe('A');
    expect(await store.get(saved.id)).toEqual(updated);
    await expect(
      store.setElevation('missing0', geometry, 1),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('keeps the share when a shared route is renamed', async () => {
    const saved = await store.save(route('old'));
    await store.setShare(saved.id, { deleteToken: 'secret', sharedAt: 5 });
    const renamed = await store.rename(saved.id, 'new');
    expect(renamed.share?.deleteToken).toBe('secret');
  });

  it('deletes a route', async () => {
    const keep = await store.save(route('keep'));
    const drop = await store.save(route('drop'));
    await store.delete(drop.id);
    expect(await store.get(drop.id)).toBeUndefined();
    expect((await store.list()).map((r) => r.id)).toEqual([keep.id]);
  });

  describe('unknown id', () => {
    it('get returns undefined', async () => {
      expect(await store.get('nope')).toBeUndefined();
    });

    it('rename fails with not_found and creates nothing', async () => {
      expect((await rejection(store.rename('nope', 'x'))).code).toBe(
        'not_found',
      );
      expect(await store.list()).toEqual([]);
    });

    it('setShare fails with not_found', async () => {
      expect(
        (
          await rejection(
            store.setShare('nope', { deleteToken: 't', sharedAt: 1 }),
          )
        ).code,
      ).toBe('not_found');
    });

    it('delete is not an error', async () => {
      await expect(store.delete('nope')).resolves.toBeUndefined();
    });
  });

  describe('storage errors', () => {
    it('reports unavailable when IndexedDB does not exist', async () => {
      const unavailable = new IndexedDbRouteStore(() => undefined);
      expect((await rejection(unavailable.list())).code).toBe('unavailable');
      expect((await rejection(unavailable.save(route('x')))).code).toBe(
        'unavailable',
      );
    });

    it('reports unavailable when opening the database is refused (private window)', async () => {
      const refusing = new IndexedDbRouteStore(
        () =>
          ({
            open() {
              throw new DOMException('refused', 'InvalidStateError');
            },
          }) as unknown as IDBFactory,
      );
      expect((await rejection(refusing.list())).code).toBe('unavailable');
    });

    it('tries to open again after a failure', async () => {
      const factory = new IDBFactory();
      let failing = true;
      const flaky = new IndexedDbRouteStore(() =>
        failing ? undefined : factory,
      );
      await rejection(flaky.list());
      failing = false;
      expect(await flaky.list()).toEqual([]);
    });

    it('reports quota when the device is full', async () => {
      const factory = new IDBFactory();
      const full = new IndexedDbRouteStore(() => factory);
      await full.list();
      // fake-indexeddb has no quota: make the write fail the way a full disk does.
      const { IDBObjectStore: FakeObjectStore } =
        await import('fake-indexeddb');
      const fakeAdd = FakeObjectStore.prototype.add;
      FakeObjectStore.prototype.add = function () {
        throw new DOMException('full', 'QuotaExceededError');
      };
      try {
        expect((await rejection(full.save(route('x')))).code).toBe('quota');
      } finally {
        FakeObjectStore.prototype.add = fakeAdd;
      }
    });
  });
});
