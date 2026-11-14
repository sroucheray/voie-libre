-- Up Migration
-- A shared route is kept for a time the person chooses (one day, one week, one month), then
-- removed. Rows that already exist get a month from now.
ALTER TABLE shared_routes
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');
-- The default only fills the rows that exist: new rows always set their own date.
ALTER TABLE shared_routes ALTER COLUMN expires_at DROP DEFAULT;
CREATE INDEX shared_routes_expires_at_idx ON shared_routes (expires_at);

-- Down Migration
DROP INDEX shared_routes_expires_at_idx;
ALTER TABLE shared_routes DROP COLUMN expires_at;
