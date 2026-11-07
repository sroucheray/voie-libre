import { Pool } from 'pg';

/** Minimal database surface used by the app, so tests can inject a fake. */
export interface Database {
  /** Resolves true when PostgreSQL answers a trivial query. Never throws. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): Database {
  // The pool connects lazily: building the app never requires a running database.
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 2000 });
  // Avoid crashing the process when an idle client errors (e.g. the database restarts).
  pool.on('error', () => undefined);
  return {
    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
