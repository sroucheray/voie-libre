-- Up Migration
-- Routes shared by link, without an account. They are immutable: a route is created once under the
-- id drawn on the author's device, and only its holder of the delete token can remove it.
CREATE TABLE shared_routes (
  id text PRIMARY KEY CHECK (id ~ '^[abcdefghijkmnpqrstuvwxyz23456789]{8,10}$'),
  name text NOT NULL,
  profile text NOT NULL CHECK (profile IN ('road', 'gravel', 'trail')),
  -- Start, waypoints and end as [[lon, lat], ...].
  points jsonb NOT NULL,
  geometry geometry(LineStringZ, 4326) NOT NULL,
  distance_meters double precision NOT NULL,
  ascent_meters double precision NOT NULL,
  duration_seconds double precision NOT NULL,
  -- When the author saved it on the device; shared_at is when it reached the server.
  created_at timestamptz NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now(),
  -- SHA-256 of the delete token returned once at creation: the token itself is never stored.
  delete_token_hash text NOT NULL
);

-- Down Migration
DROP TABLE shared_routes;
