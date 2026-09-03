/**
 * Environment-driven settings. Keeps config out of code and secrets out of git.
 *
 * Ported from `app/config.py`. Nothing here has a production-safe default:
 * `SECRET_KEY` ships as an obvious placeholder so an unconfigured deployment
 * fails an explicit startup check rather than quietly running with a known key.
 */

export const INSECURE_SECRET_KEY = "dev-only-insecure-key-change-me";

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface Settings {
  appEnv: string;
  logLevel: string;
  /** Read-write connection string for the platform's own schema. */
  databaseUrl: string | null;
  /** Separate database for the test suite; never the same as `databaseUrl`. */
  testDatabaseUrl: string | null;
  secretKey: string;
  /** Twelve hours, in seconds. */
  sessionMaxAge: number;
  isProduction: boolean;
}

export function settings(): Settings {
  const appEnv = env("APP_ENV", "development");
  return {
    appEnv,
    logLevel: env("LOG_LEVEL", "INFO"),
    databaseUrl: process.env.DATABASE_URL ?? null,
    testDatabaseUrl: process.env.TEST_DATABASE_URL ?? null,
    secretKey: env("SECRET_KEY", INSECURE_SECRET_KEY),
    sessionMaxAge: envNumber("SESSION_MAX_AGE", 43_200),
    isProduction: ["production", "prod"].includes(appEnv.toLowerCase()),
  };
}

/** Configuration problems that must not reach production. Returns messages. */
export function startupChecks(): string[] {
  const config = settings();
  const problems: string[] = [];
  if (!config.isProduction) return problems;

  if (config.secretKey === INSECURE_SECRET_KEY) {
    problems.push("SECRET_KEY is still the shipped placeholder");
  }
  if (config.secretKey.length < 32) {
    problems.push("SECRET_KEY is shorter than 32 characters");
  }
  if (!config.databaseUrl) {
    problems.push("DATABASE_URL is not set");
  }
  return problems;
}
