/** A minimal in-memory Cache: enough for put, match and delete. */
class FakeCache {
  readonly entries = new Map<string, { blob: Blob; headers: Headers }>();

  constructor(private readonly failure: () => Error | null) {}

  async put(url: string, response: Response) {
    const error = this.failure();
    if (error) throw error;
    this.entries.set(url, {
      blob: await response.blob(),
      headers: new Headers(response.headers),
    });
  }

  async delete(url: string) {
    return this.entries.delete(url);
  }

  async match(url: string) {
    const entry = this.entries.get(url);
    return entry
      ? new Response(entry.blob, { headers: entry.headers })
      : undefined;
  }
}

/** A minimal in-memory CacheStorage: enough for open, has and delete. */
export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  /** Makes `put` fail with this error, e.g. a quota error. */
  putError: Error | null = null;

  async has(name: string) {
    return this.caches.has(name);
  }

  async open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache(() => this.putError);
      this.caches.set(name, cache);
    }
    return cache;
  }

  async delete(name: string) {
    return this.caches.delete(name);
  }
}
