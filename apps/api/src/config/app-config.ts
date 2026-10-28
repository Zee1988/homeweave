import { databasePathFromUrl, resolveDatabaseUrl } from './database-url';
import { ConfigError } from './errors';
import {
  FALLBACK_LOG_LEVEL,
  resolveLogLevel,
  type LogLevel,
  type LogLevelSource,
  type OptionsFileReader,
  readOptionsFile,
} from './log-level';

// Single entry point for every runtime setting the process needs before it can serve
// a request: the listening port, the database location and the log level.
//
// Resolution happens once, in main.ts, and the result is passed down explicitly. No
// module re-reads process.env for these values: two independent resolutions of the
// same variable is how a container ends up writing to one database file and checking
// the disk space of another (03-PATTERNS.md D-09).

/** Matches `ingress_port` in homeweave_app/config.yaml and the port the watchdog probes. */
export const DEFAULT_PORT = 8099;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/**
 * Re-exported from `./errors`, which owns the exit-code mapping. Kept exported here so
 * every existing `ConfigError` import keeps working; the class itself must not be
 * declared twice — a second definition would pass `instanceof` for one throw site and
 * fail it for the other, and the exit code would silently become 1.
 */
export { ConfigError };

export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** Same path the Prisma adapter opens, after the adapter's own `file:` handling. */
  databasePath: string;
  logLevel: LogLevel;
  logLevelSource: LogLevelSource;
}

/**
 * Validates PORT. Out-of-range input is fatal: silently clamping it would make the
 * app listen somewhere the Supervisor watchdog never probes, so it would be restarted
 * forever with a healthy-looking log.
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new ConfigError(
      'invalid_port',
      `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}, received ${JSON.stringify(raw)}`,
    );
  }
  return port;
}

export function loadAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  optionsFileReader: OptionsFileReader = readOptionsFile,
): AppConfig {
  const databaseUrl = resolveDatabaseUrl(env);
  const logLevel = resolveLogLevel(env, optionsFileReader);

  return {
    port: resolvePort(env),
    databaseUrl,
    databasePath: databasePathFromUrl(databaseUrl),
    logLevel: logLevel.level,
    logLevelSource: logLevel.source,
  };
}

export { FALLBACK_LOG_LEVEL };
