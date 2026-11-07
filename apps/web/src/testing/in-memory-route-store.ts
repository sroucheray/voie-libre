import {
  RouteStore,
  RouteStoreError,
  ROUTE_STORE,
} from '../app/storage/route-store';
import { createRouteId } from '../app/storage/route-id';
import {
  NewSavedRoute,
  SAVED_ROUTE_SCHEMA_VERSION,
  SavedRoute,
  ShareInfo,
} from '../app/storage/saved-route';

/**
 * A RouteStore without IndexedDB (jsdom has none). `failWith` makes every call fail, to test how
 * the UI reports storage errors.
 */
export class InMemoryRouteStore implements RouteStore {
  readonly records = new Map<string, SavedRoute>();
  failWith: RouteStoreError | null = null;
  private clock = 1_700_000_000_000;

  async save(route: NewSavedRoute): Promise<SavedRoute> {
    this.check();
    this.clock += 60_000;
    const record: SavedRoute = {
      ...route,
      schemaVersion: SAVED_ROUTE_SCHEMA_VERSION,
      id: createRouteId(),
      createdAt: this.clock,
      updatedAt: this.clock,
    };
    this.records.set(record.id, record);
    return record;
  }
  async list(): Promise<SavedRoute[]> {
    this.check();
    return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(id: string): Promise<SavedRoute | undefined> {
    this.check();
    return this.records.get(id);
  }
  async rename(id: string, name: string): Promise<SavedRoute> {
    this.check();
    const existing = this.records.get(id);
    if (!existing) throw new RouteStoreError('not_found');
    const updated = { ...existing, name, updatedAt: existing.updatedAt + 1 };
    this.records.set(id, updated);
    return updated;
  }
  async setShare(id: string, share: ShareInfo | null): Promise<SavedRoute> {
    this.check();
    const existing = this.records.get(id);
    if (!existing) throw new RouteStoreError('not_found');
    const { share: _previous, ...rest } = existing;
    const updated = share ? { ...rest, share } : rest;
    this.records.set(id, updated);
    return updated;
  }
  async delete(id: string): Promise<void> {
    this.check();
    this.records.delete(id);
  }

  private check() {
    if (this.failWith) throw this.failWith;
  }
}

export function provideInMemoryRouteStore(store = new InMemoryRouteStore()) {
  return { provide: ROUTE_STORE, useValue: store };
}
