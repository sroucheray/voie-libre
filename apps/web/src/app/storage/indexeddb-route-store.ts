import type { ElevationSource } from '../planner/planner-store';
import { RouteStore, RouteStoreError } from './route-store';
import { createRouteId } from './route-id';
import {
  NewSavedRoute,
  SAVED_ROUTE_SCHEMA_VERSION,
  SavedRoute,
  ShareInfo,
} from './saved-route';

export const DATABASE_NAME = 'voie-libre';
const DATABASE_VERSION = 1;
const STORE = 'routes';
/** A random id collision is astronomically unlikely; a few retries make it harmless. */
const ID_ATTEMPTS = 5;

function toStoreError(error: unknown): RouteStoreError {
  if (error instanceof RouteStoreError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') {
    return new RouteStoreError('quota', { cause: error });
  }
  // Firefox in a private window fails to open the database with an InvalidStateError.
  if (
    name === 'InvalidStateError' ||
    name === 'SecurityError' ||
    name === 'NotSupportedError' ||
    name === 'UnknownError'
  ) {
    return new RouteStoreError('unavailable', { cause: error });
  }
  return new RouteStoreError('unknown', { cause: error });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // A quota error surfaces on the transaction when it is committed.
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Saved routes in IndexedDB, through the native API: one object store keyed by id, nothing to
 * migrate yet. Any failure is reported as a {@link RouteStoreError}.
 */
export class IndexedDbRouteStore implements RouteStore {
  private database: Promise<IDBDatabase> | null = null;

  /** `factory` is injectable so tests can use `fake-indexeddb`. */
  constructor(
    private readonly factory: () => IDBFactory | undefined = () =>
      globalThis.indexedDB,
  ) {}

  async save(route: NewSavedRoute): Promise<SavedRoute> {
    const now = Date.now();
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
      const record: SavedRoute = {
        ...route,
        schemaVersion: SAVED_ROUTE_SCHEMA_VERSION,
        id: createRouteId(),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.run('readwrite', (store) => store.add(record));
        return record;
      } catch (error) {
        // `add` refuses an existing key with a ConstraintError: draw another id.
        const isCollision =
          (error as { cause?: { name?: string } }).cause?.name ===
          'ConstraintError';
        if (!isCollision) throw error;
      }
    }
    throw new RouteStoreError('unknown');
  }

  async list(): Promise<SavedRoute[]> {
    const all = await this.run('readonly', (store) => store.getAll());
    return (all as SavedRoute[]).sort(
      (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
    );
  }

  async get(id: string): Promise<SavedRoute | undefined> {
    const found = await this.run('readonly', (store) => store.get(id));
    return found as SavedRoute | undefined;
  }

  async rename(id: string, name: string): Promise<SavedRoute> {
    return this.update(id, (route) => ({
      ...route,
      name,
      updatedAt: Date.now(),
    }));
  }

  async setShare(id: string, share: ShareInfo | null): Promise<SavedRoute> {
    return this.update(id, (route) => {
      const { share: _previous, ...rest } = route;
      return share ? { ...rest, share } : rest;
    });
  }

  async setLaps(id: string, laps: number): Promise<SavedRoute> {
    return this.update(id, (route) => {
      const { laps: _previous, ...rest } = route;
      return laps > 1 ? { ...rest, laps } : rest;
    });
  }

  async setElevation(
    id: string,
    geometry: [number, number, number][],
    ascentMeters: number,
    elevationSource?: ElevationSource,
  ): Promise<SavedRoute> {
    return this.update(id, (route) => ({
      ...route,
      geometry,
      ascentMeters,
      ...(elevationSource ? { elevationSource } : {}),
      updatedAt: Date.now(),
    }));
  }

  /** Reads, changes and writes a record in one transaction. `not_found` when it does not exist. */
  private async update(
    id: string,
    change: (route: SavedRoute) => SavedRoute,
  ): Promise<SavedRoute> {
    const db = await this.open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const existing = (await request(store.get(id))) as SavedRoute | undefined;
      if (!existing) {
        tx.abort();
        throw new RouteStoreError('not_found');
      }
      const updated = change(existing);
      store.put(updated);
      await transactionDone(tx);
      return updated;
    } catch (error) {
      throw toStoreError(error);
    }
  }

  async delete(id: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(id));
  }

  /** Runs one request in its own transaction and waits for the commit. */
  private async run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    try {
      const tx = db.transaction(STORE, mode);
      // Both settle together, so a failing transaction never leaves an unhandled rejection.
      const [result] = await Promise.all([
        request(operation(tx.objectStore(STORE))),
        transactionDone(tx),
      ]);
      return result;
    } catch (error) {
      throw toStoreError(error);
    }
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= this.openDatabase().catch((error: unknown) => {
      // Do not cache a failure: the next call tries again.
      this.database = null;
      throw toStoreError(error);
    });
    return this.database;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const factory = this.factory();
      if (!factory) {
        reject(new RouteStoreError('unavailable'));
        return;
      }
      let opening: IDBOpenDBRequest;
      try {
        opening = factory.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      opening.onsuccess = () => {
        const db = opening.result;
        // Another tab upgrades the schema: release our connection so it is not blocked.
        db.onversionchange = () => {
          db.close();
          this.database = null;
        };
        resolve(db);
      };
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => reject(new RouteStoreError('unavailable'));
    });
  }
}
