import type { Pool } from 'pg';

export type Profile = 'road' | 'gravel' | 'trail';
export type Coordinates = [number, number];
export type Coordinates3 = [number, number, number];

/** A route shared by link: the same fields as on the author's device, plus when it was shared. */
export interface SharedRoute {
  id: string;
  name: string;
  profile: Profile;
  /** Start, waypoints and end. */
  points: Coordinates[];
  geometry: Coordinates3[];
  distanceMeters: number;
  ascentMeters: number;
  durationSeconds: number;
  /** Milliseconds since the epoch, as saved on the device. */
  createdAt: number;
  sharedAt: number;
}

export type NewSharedRoute = Omit<SharedRoute, 'sharedAt'>;

export type RemoveResult = 'deleted' | 'not_found' | 'forbidden';

/** Storage of shared routes. Immutable: there is no update. */
export interface SharedRouteStore {
  /** Returns false, and stores nothing, when the id is already taken. */
  create(route: NewSharedRoute, deleteTokenHash: string): Promise<boolean>;
  get(id: string): Promise<SharedRoute | null>;
  /** Deletes the route when `deleteTokenHash` is the one stored with it. */
  remove(id: string, deleteTokenHash: string): Promise<RemoveResult>;
}

interface Row {
  id: string;
  name: string;
  profile: Profile;
  points: Coordinates[];
  geometry: { coordinates: Coordinates3[] };
  distance_meters: number;
  ascent_meters: number;
  duration_seconds: number;
  created_at_ms: number;
  shared_at_ms: number;
}

/** PostgreSQL implementation: the itinerary is a PostGIS `LineStringZ`. */
export function createPostgresSharedRoutes(
  pool: Pick<Pool, 'query'>,
): SharedRouteStore {
  return {
    async create(route, deleteTokenHash) {
      const result = await pool.query(
        `INSERT INTO shared_routes
           (id, name, profile, points, geometry, distance_meters, ascent_meters,
            duration_seconds, created_at, delete_token_hash)
         VALUES ($1, $2, $3, $4::jsonb,
                 ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
                 $6, $7, $8, to_timestamp($9::double precision / 1000), $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          route.id,
          route.name,
          route.profile,
          JSON.stringify(route.points),
          JSON.stringify({ type: 'LineString', coordinates: route.geometry }),
          route.distanceMeters,
          route.ascentMeters,
          route.durationSeconds,
          route.createdAt,
          deleteTokenHash,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async get(id) {
      const { rows } = await pool.query<Row>(
        `SELECT id, name, profile, points,
                ST_AsGeoJSON(geometry, 7)::json AS geometry,
                distance_meters, ascent_meters, duration_seconds,
                floor(extract(epoch FROM created_at) * 1000)::float8 AS created_at_ms,
                floor(extract(epoch FROM shared_at) * 1000)::float8 AS shared_at_ms
           FROM shared_routes WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        profile: row.profile,
        points: row.points,
        geometry: row.geometry.coordinates,
        distanceMeters: row.distance_meters,
        ascentMeters: row.ascent_meters,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at_ms,
        sharedAt: row.shared_at_ms,
      };
    },

    async remove(id, deleteTokenHash) {
      const deleted = await pool.query(
        'DELETE FROM shared_routes WHERE id = $1 AND delete_token_hash = $2',
        [id, deleteTokenHash],
      );
      if ((deleted.rowCount ?? 0) > 0) return 'deleted';
      const exists = await pool.query(
        'SELECT 1 FROM shared_routes WHERE id = $1',
        [id],
      );
      return (exists.rowCount ?? 0) > 0 ? 'forbidden' : 'not_found';
    },
  };
}

/** In memory, for tests and for generating the OpenAPI document. */
export function createMemorySharedRoutes(): SharedRouteStore & {
  readonly size: number;
} {
  const routes = new Map<string, { route: SharedRoute; hash: string }>();
  return {
    get size() {
      return routes.size;
    },
    async create(route, deleteTokenHash) {
      if (routes.has(route.id)) return false;
      routes.set(route.id, {
        route: { ...route, sharedAt: Date.now() },
        hash: deleteTokenHash,
      });
      return true;
    },
    async get(id) {
      return routes.get(id)?.route ?? null;
    },
    async remove(id, deleteTokenHash) {
      const entry = routes.get(id);
      if (!entry) return 'not_found';
      if (entry.hash !== deleteTokenHash) return 'forbidden';
      routes.delete(id);
      return 'deleted';
    },
  };
}
