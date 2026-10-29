import { readFileSync } from 'node:fs';

// Log level resolution (D-04).
//
// Priority: LOG_LEVEL env var -> the options file written by the Home Assistant
// Supervisor -> 'info'. A missing or corrupt options file is an expected condition,
// not a failure. The path is owned by the Supervisor and this repository has no
// producer for it (03-RESEARCH.md §5.4, assumption A3).
//
// A3 does not hold on HAOS (0.1.2 on-device, defect F-1): the Supervisor rewrites the
// file as root:root 0600 at runtime, so it can exist and still be unreadable by uid
// 1000. That case is `source: 'unreadable'`, not 'fallback' -- the two need different
// operator actions ("set an option" vs "fix /data ownership"), and collapsing them is
// what made the setting look accepted while being silently ignored.
export const OPTIONS_FILE_PATH = '/data/options.json';

// Mirrors `app.optionDefs.logLevel.values` in homeweave_app/app-metadata.json, which
// the generator turns into `schema.log_level: "list(info|debug|warn)"` in
// config.yaml. Accepting a level that is not in that list would produce a value the
// Supervisor UI can never set, so widening this list requires the same edit in
// app-metadata.json plus `corepack pnpm generate:app`.
export const LOG_LEVELS = ['info', 'debug', 'warn'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Where the resolved level came from — surfaced in the startup log so an operator can
 * tell "the container ignored my setting" from "the setting was rejected".
 */
export type LogLevelSource = 'env' | 'options' | 'invalid' | 'unreadable' | 'fallback';

export interface ResolvedLogLevel {
  level: LogLevel;
  source: LogLevelSource;
}

export const FALLBACK_LOG_LEVEL: LogLevel = 'info';

/** Injected in tests; the default reads the real options file. */
export type OptionsFileReader = (optionsPath: string) => unknown;

/** ENOENT / bad JSON are "nothing to read"; EACCES / EPERM are "there is a file I
 *  cannot read". Only the second one is a defect worth a warning, and `fs` reports it
 *  as `code` on the thrown error rather than as a distinguishable return value. */
function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

/**
 * Parsed options file, or null when it is missing or not valid JSON.
 *
 * Throws only for a permission error, and deliberately: the caller has to tell "the
 * Supervisor never wrote options" from "the Supervisor wrote them where this user
 * cannot see them" (F-1). Swallowing both is what made a live option silently
 * ineffective with no log line at all.
 */
export function readOptionsFile(optionsPath: string = OPTIONS_FILE_PATH): unknown {
  try {
    return JSON.parse(readFileSync(optionsPath, 'utf8'));
  } catch (error) {
    if (isPermissionError(error)) throw error;
    return null;
  }
}

function asLogLevel(value: unknown): LogLevel | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return (LOG_LEVELS as readonly string[]).includes(candidate) ? (candidate as LogLevel) : null;
}

// The Supervisor writes options.json from the `options:` / `schema:` keys of the
// generated config.yaml, which are snake_case (`log_level`). The camelCase spelling is
// accepted as well so a hand-written file for local debugging does not silently lose
// the setting. Keep `log_level` first: it is the spelling the generator produces.
function levelFieldFromOptions(options: unknown): unknown {
  if (typeof options !== 'object' || options === null) return undefined;
  const record = options as Record<string, unknown>;
  if (record.log_level !== undefined) return record.log_level;
  return record.logLevel;
}

/**
 * Resolves the effective log level.
 *
 * An out-of-range value never escalates: it degrades to 'info' and reports
 * `source: 'invalid'`, because a bad log level must not stop the app from starting.
 */
export function resolveLogLevel(
  env: NodeJS.ProcessEnv = process.env,
  optionsFileReader: OptionsFileReader = readOptionsFile,
): ResolvedLogLevel {
  const fromEnv = env.LOG_LEVEL;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const level = asLogLevel(fromEnv);
    return level === null
      ? { level: FALLBACK_LOG_LEVEL, source: 'invalid' }
      : { level, source: 'env' };
  }

  let options: unknown = null;
  let unreadable = false;
  try {
    options = optionsFileReader(OPTIONS_FILE_PATH);
  } catch (error) {
    // Only a permission error separates "no options file" from "an options file this
    // user cannot read". Anything else thrown by an injected reader is treated as
    // absent, which keeps the "never breaks startup" contract for real defects.
    unreadable = isPermissionError(error);
    options = null;
  }

  if (unreadable) {
    return { level: FALLBACK_LOG_LEVEL, source: 'unreadable' };
  }

  const fromOptions = levelFieldFromOptions(options);
  if (fromOptions === undefined || fromOptions === null) {
    return { level: FALLBACK_LOG_LEVEL, source: 'fallback' };
  }

  const level = asLogLevel(fromOptions);
  return level === null
    ? { level: FALLBACK_LOG_LEVEL, source: 'invalid' }
    : { level, source: 'options' };
}
