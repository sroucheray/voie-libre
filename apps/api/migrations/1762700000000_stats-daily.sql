-- Up Migration
-- Audience statistics, aggregated: one row per day, metric and dimension. There is no address,
-- user-agent, path, place or coordinate here, and no row per visit: only counts and, for a few
-- metrics, a sum (kilometres, points, stops) so that a mean is a sum divided by a count.
CREATE TABLE stats_daily (
  day date NOT NULL,
  metric text NOT NULL,
  dimension text NOT NULL,
  count bigint NOT NULL DEFAULT 0,
  total double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, dimension)
);

-- Down Migration
DROP TABLE stats_daily;
