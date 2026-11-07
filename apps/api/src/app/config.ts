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
  brouterUrl: string;
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
    brouterUrl: env['BROUTER_URL'] || 'http://localhost:17777',
    logLevel: env['LOG_LEVEL'] || 'info',
  };
}
