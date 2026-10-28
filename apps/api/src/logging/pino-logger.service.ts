import { Injectable, type LogLevel, type LoggerService } from '@nestjs/common';
import pino, { type Logger as Pino } from 'pino';

// Adapts pino to the NestJS `LoggerService` contract so every Nest internal log
// (bootstrap, route mapping, unhandled exceptions) goes through one structured writer.
//
// Scope of this file, deliberately narrow: structure + level only.
//   - NO `redact` config and NO `sanitize()` call. pino's `redact` cannot express
//     key-name blacklists at arbitrary depth, value patterns (`Bearer ...`) or cycle
//     protection, so it is not the answer to D-03 (03-RESEARCH.md §5.2). Masking is
//     implemented in 03-03 and hooks in at the marked point below.
//   - NO pino transport. Writes are synchronous to stdout, so this phase never needs
//     `logger.flush()`; the 03-05 shutdown path must therefore not call it either
//     (a drain that has nothing to drain is a lie in the shutdown budget).

/** pino's own level names, which do not match Nest's 1:1 (see `NEST_TO_PINO`). */
type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * `verbose` has no pino counterpart: Nest uses it below `debug`, pino's lowest level
 * is `trace`. Mapping it to `trace` keeps the ordering instead of dropping the call.
 */
const NEST_TO_PINO: Record<LogLevel, PinoLevel> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

/** Verbosity rank, lowest first — `setLogLevels` resolves the set to one pino level. */
const PINO_ORDER: readonly PinoLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export interface PinoLoggerServiceOptions {
  /** Level for the process. Resolved once by `loadAppConfig()` and passed in. */
  level?: PinoLevel;
  /**
   * Injected writer. The repo's existing convention for untestable side effects is to
   * inject them as an optional parameter with the real implementation as the default
   * (`scripts/ci/build-image.mjs:56`, `scripts/lint-workspace.mjs:105`) — tests assert
   * level mapping and context extraction on a fake, never by spying on stdout
   * (03-PATTERNS.md §3).
   */
  pino?: Pino;
}

@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly pino: Pino;

  constructor(options: PinoLoggerServiceOptions = {}) {
    this.pino =
      options.pino ??
      pino({
        level: options.level ?? 'info',
        // `base` carries the stable identity of the emitter; the HA Supervisor collects
        // stdout from several apps, so an unprefixed line is unattributable.
        base: { service: 'homeweave-api' },
        // Fixed-width ISO timestamps sort correctly as text when the Supervisor tails
        // the log with `--no-timestamps`, which is what the operator copy/pastes.
        timestamp: pino.stdTimeFunctions.isoTime,
        // sanitize hook: 见 03-03
      });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('info', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  /**
   * Nest's calling convention is `(message, stack?, context?)` (03-RESEARCH.md §5.1,
   * `[ASSUMED]` — verified against `@nestjs/common/services/logger.service.d.ts`, not
   * against a running Nest 12 exceptions filter). The stack lands in `err.stack` rather
   * than being concatenated into `msg`: a single-line JSON log with the stack in its own
   * field stays greppable, while a multi-line `msg` breaks one-record-per-line parsing.
   */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams, { allowStack: true });
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('trace', message, optionalParams);
  }

  /** Same name as pino's `fatal` on purpose — do not fold it into `error`. */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  /**
   * pino has a single threshold, Nest hands us a set. Enabling
   * `['error', 'warn']` must silence `info`, so resolve to the most verbose level in
   * the set; an empty set means "log nothing".
   */
  setLogLevels(levels: LogLevel[]): void {
    if (levels.length === 0) {
      this.pino.level = 'silent';
      return;
    }
    const mapped = levels.map((level) => NEST_TO_PINO[level] ?? 'info');
    const mostVerbose = mapped.reduce((lowest, candidate) =>
      PINO_ORDER.indexOf(candidate) < PINO_ORDER.indexOf(lowest) ? candidate : lowest,
    );
    this.pino.level = mostVerbose;
  }

  private emit(
    level: PinoLevel,
    message: unknown,
    optionalParams: readonly unknown[],
    options: { allowStack?: boolean } = {},
  ): void {
    const params = [...optionalParams];
    const { stack, context, data } = splitParams(params, options.allowStack === true);

    const payload: Record<string, unknown> = {};
    if (context !== undefined) payload.context = context;
    if (stack !== undefined) payload.err = { stack };
    if (data.length === 1) payload.data = data[0];
    else if (data.length > 1) payload.data = data;

    // Non-string messages (objects, errors) are the data, never the msg field: pino
    // would otherwise stringify them with its own lossy `String()` fallback. A plain
    // object is spread so its keys stay top-level fields — that is what makes a line
    // like the startup record queryable by `port` instead of buried under `data`.
    const text = typeof message === 'string' ? message : undefined;
    if (typeof message !== 'string') {
      if (isPlainObject(message)) {
        Object.assign(payload, message);
        if (data.length > 0) payload.data = data;
      } else {
        payload.data = data.length > 0 ? [message, ...data] : message;
      }
    }

    switch (level) {
      case 'trace':
        this.pino.trace(payload, text);
        break;
      case 'debug':
        this.pino.debug(payload, text);
        break;
      case 'info':
        this.pino.info(payload, text);
        break;
      case 'warn':
        this.pino.warn(payload, text);
        break;
      case 'error':
        this.pino.error(payload, text);
        break;
      case 'fatal':
        this.pino.fatal(payload, text);
        break;
    }
  }
}

/** Guards the spread above: a Prisma error or a Date must stay under `data`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Splits Nest's trailing varargs into `{ stack?, context?, data }`.
 *
 * Nest passes plain strings last, and a string is also a legal log payload, so the
 * positional rule is: `(message, stack, context)` when `allowStack` and two trailing
 * strings are present; otherwise one trailing string is the context. Anything that is
 * not a string stays `data` and is never interpreted as position — a string message in
 * a data slot must not silently become the log context.
 */
function splitParams(
  params: unknown[],
  allowStack: boolean,
): { stack?: string; context?: string; data: unknown[] } {
  let stack: string | undefined;
  let context: string | undefined;

  if (allowStack && params.length >= 2) {
    const [maybeStack] = params;
    const last = params[params.length - 1];
    if (typeof maybeStack === 'string' && typeof last === 'string') {
      stack = maybeStack;
      context = last;
      params.splice(0, 1);
      params.pop();
    }
  }

  if (context === undefined) {
    const last = params[params.length - 1];
    if (typeof last === 'string' && params.length > 0) {
      context = last;
      params.pop();
    }
  }

  return { stack, context, data: params };
}
