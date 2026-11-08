/** Runtime configuration, read from environment variables only (no secret in the repository). */
export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  /** Origins allowed by CORS, e.g. the Angular dev server. */
  corsOrigins: string[];
  rateLimitMax: number;
  /** Rate-limit window in milliseconds. */
  rateLimitWindowMs: number;
  /** Stricter limit for POST /route, which calls the routing engine. */
  routeRateLimitMax: number;
  /** Limit for POST /elevation (up to 5000 points per request). */
  elevationRateLimitMax: number;
  /** Limit for GET /geocode and /geocode/reverse (search as you type needs room). */
  geocodeRateLimitMax: number;
  /** Photon server asked for places; the public one by default (only the API calls it). */
  geocoderUrl: string;
  /** Stricter limit for PUT /p/{id}: anyone can write without an account. */
  shareRateLimitMax: number;
  shareRateLimitWindowMs: number;
  /** Largest accepted body for PUT /p/{id}, in bytes. */
  shareBodyLimitBytes: number;
  brouterUrl: string;
  /** Directory of the Copernicus GLO-30 tiles (see scripts/download-relief.sh). */
  reliefDir: string;
  logLevel: string;
}

function integer(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got "${value}"`,
    );
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env['HOST'] || 'localhost',
    port: integer('PORT', env['PORT'], 3000),
    databaseUrl:
      env['DATABASE_URL'] ||
      'postgres://voielibre:voielibre@localhost:5432/voielibre',
    corsOrigins: (env['CORS_ORIGINS'] || 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitMax: integer('RATE_LIMIT_MAX', env['RATE_LIMIT_MAX'], 100),
    rateLimitWindowMs: integer(
      'RATE_LIMIT_WINDOW_MS',
      env['RATE_LIMIT_WINDOW_MS'],
      60_000,
    ),
    routeRateLimitMax: integer(
      'ROUTE_RATE_LIMIT_MAX',
      env['ROUTE_RATE_LIMIT_MAX'],
      20,
    ),
    elevationRateLimitMax: integer(
      'ELEVATION_RATE_LIMIT_MAX',
      env['ELEVATION_RATE_LIMIT_MAX'],
      30,
    ),
    geocodeRateLimitMax: integer(
      'GEOCODE_RATE_LIMIT_MAX',
      env['GEOCODE_RATE_LIMIT_MAX'],
      60,
    ),
    geocoderUrl: env['GEOCODER_URL'] || 'https://photon.komoot.io',
    shareRateLimitMax: integer(
      'SHARE_RATE_LIMIT_MAX',
      env['SHARE_RATE_LIMIT_MAX'],
      10,
    ),
    shareRateLimitWindowMs: integer(
      'SHARE_RATE_LIMIT_WINDOW_MS',
      env['SHARE_RATE_LIMIT_WINDOW_MS'],
      3_600_000,
    ),
    shareBodyLimitBytes: integer(
      'SHARE_BODY_LIMIT_BYTES',
      env['SHARE_BODY_LIMIT_BYTES'],
      1_000_000,
    ),
    brouterUrl: env['BROUTER_URL'] || 'http://localhost:17777',
    reliefDir: env['RELIEF_DIR'] || 'data/relief',
    logLevel: env['LOG_LEVEL'] || 'info',
  };
}
