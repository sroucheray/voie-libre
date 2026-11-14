import type { Pool } from 'pg';

/** One counter to raise: `count` events and, when it makes sense, their `total`. */
export interface StatsEntry {
  metric: string;
  dimension: string;
  count: number;
  total: number;
}

/** Aggregated audience statistics. Nothing here can identify a visitor or a route. */
export interface StatsStore {
  /** Adds the entries to the counters of `day` (`YYYY-MM-DD`, UTC). */
  add(day: string, entries: StatsEntry[]): Promise<void>;
  /** Removes the days strictly before `day`; returns how many rows went. */
  deleteBefore(day: string): Promise<number>;
}

export function createPostgresStats(pool: Pick<Pool, 'query'>): StatsStore {
  return {
    async add(day, entries) {
      for (const { metric, dimension, count, total } of entries) {
        await pool.query(
          `INSERT INTO stats_daily (day, metric, dimension, count, total)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (day, metric, dimension)
           DO UPDATE SET count = stats_daily.count + EXCLUDED.count,
                         total = stats_daily.total + EXCLUDED.total`,
          [day, metric, dimension, count, total],
        );
      }
    },
    async deleteBefore(day) {
      const result = await pool.query(
        'DELETE FROM stats_daily WHERE day < $1',
        [day],
      );
      return result.rowCount ?? 0;
    },
  };
}

/** In memory, for tests. */
export function createMemoryStats(): StatsStore & {
  rows(): Array<StatsEntry & { day: string }>;
} {
  const rows = new Map<string, StatsEntry & { day: string }>();
  return {
    rows: () => [...rows.values()],
    async add(day, entries) {
      for (const entry of entries) {
        const key = `${day}|${entry.metric}|${entry.dimension}`;
        const row = rows.get(key) ?? { ...entry, day, count: 0, total: 0 };
        row.count += entry.count;
        row.total += entry.total;
        rows.set(key, row);
      }
    },
    async deleteBefore(day) {
      let removed = 0;
      for (const [key, row] of rows) {
        if (row.day < day) {
          rows.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
