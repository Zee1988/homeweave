// The two exit codes the Supervisor can act on, and the single place a failure is turned
// into them (03-05 Task 1, threat T-03-09).
//
// Why 78 and not 1: 78 is `EX_CONFIG` from sysexits.h, and it is the only signal that
// distinguishes "the operator gave this container an environment it cannot work with"
// from "something unexpected broke". A Supervisor restart loop is identical in both cases,
// so the log line and the exit code are the only channels that carry the difference. If
// everything exited 1, an unwritable `/data` mount would look exactly like a crash.
//
// This module has no `@nestjs/*` and no I/O: it is loaded by `--experimental-strip-types`
// in the startup-checks unit test.

/** sysexits.h EX_CONFIG — a configuration problem the operator can fix. */
export const EXIT_CONFIG = 78;

/** Everything else that prevents serving: a broken dependency, an unexpected throw. */
export const EXIT_STARTUP = 1;

export type StartupExitCode = typeof EXIT_CONFIG | typeof EXIT_STARTUP;

/**
 * The closed vocabulary a failure is reported with.
 *
 * Closed on purpose: `reason` lands in a log record that a human reads at 2am, and a
 * free-form string there degrades into `TypeError: Cannot read properties of undefined`
 * sooner or later. Each member maps to exactly one operator action:
 *
 *   invalid_port         fix PORT (the watchdog probes 8099; see app-metadata.json)
 *   database_path_empty  set DATABASE_URL
 *   dir_missing          create the volume / fix the bind mount
 *   dir_readonly         fix ownership of the mounted volume (03-VALIDATION.md A2)
 *   write_failed         the volume is full or the probe file is blocked
 *   query_failed         the database file is not a usable SQLite database
 *   migrations_unreadable the image is missing `prisma/migrations`
 *   unexpected           a defect, not a misconfiguration
 */
export type StartupReason =
  | 'invalid_port'
  | 'database_path_empty'
  | 'dir_missing'
  | 'dir_readonly'
  | 'write_failed'
  | 'query_failed'
  | 'migrations_unreadable'
  | 'unexpected';

export interface StartupFailure {
  reason: StartupReason;
  exitCode: StartupExitCode;
  message: string;
}

/**
 * A configuration problem. The `reason` defaults to `invalid_port` because that is the
 * first check that can throw this and the only caller that predates 03-05 is
 * `resolvePort()`.
 */
export class ConfigError extends Error {
  readonly exitCode: StartupExitCode = EXIT_CONFIG;
  readonly reason: StartupReason;

  // Fields are declared and assigned explicitly rather than through a parameter property:
  // Node's `--experimental-strip-types` (which the unit tests run under) rejects parameter
  // properties outright, so the shorthand would make this module un-importable from a test.
  constructor(reason: StartupReason = 'invalid_port', message?: string) {
    // The reason doubles as the message when none is given, so a throw site cannot end up
    // with an empty string in the log.
    super(message ?? reason);
    this.reason = reason;
    this.name = 'ConfigError';
  }
}

/**
 * A startup failure that is not the operator's configuration: the database answered
 * garbage, the migrations directory is missing from the image, or something threw.
 */
export class StartupError extends Error {
  readonly exitCode: StartupExitCode = EXIT_STARTUP;
  readonly reason: StartupReason;

  constructor(reason: StartupReason = 'unexpected', message?: string) {
    super(message ?? reason);
    this.reason = reason;
    this.name = 'StartupError';
  }
}

/**
 * Reduces anything thrown during boot to the triple `main.ts` logs and exits with.
 *
 * Kept pure and exported so the mapping is unit-testable without spawning a process:
 * a wrong exit code here is invisible locally (the process dies either way) and only
 * shows up as an unhelpful restart loop on a real installation.
 */
export function toStartupFailure(error: unknown): StartupFailure {
  if (error instanceof ConfigError || error instanceof StartupError) {
    return { reason: error.reason, exitCode: error.exitCode, message: error.message };
  }

  // An unknown throw is never a configuration verdict: blaming the operator for a defect
  // would send them to change settings that were fine.
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { reason: 'unexpected', exitCode: EXIT_STARTUP, message };
}
