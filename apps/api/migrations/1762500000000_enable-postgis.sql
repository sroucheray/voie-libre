-- Up Migration
-- PostGIS provides the geometry types and indexes used for routes and avoid zones.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Down Migration
DROP EXTENSION IF EXISTS postgis;
