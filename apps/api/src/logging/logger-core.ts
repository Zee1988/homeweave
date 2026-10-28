// Why this exists apart from `pino-logger.service.ts` (03-03):
//
// A file that uses `@Injectable()` cannot be unit-tested through
// `node --experimental-strip-types`: the decorator survives stripping,
// `emitDecoratorMetadata` does not, so the class only evaluates inside a Nest container.
// Everything worth asserting — positional parsing, level mapping, redaction, request
// correlation — therefore lives here, in a factory that takes its writer as an argument.
// The service degrades to `@Injectable()` plus a pino instance and forwards seven methods.
//
// Two constraints shape the signatures below:
//   - No `@nestjs/*` import. Level names are mirrored locally and the writer is a narrow
//     structural interface rather than pino's full `Logger` type.
//   - **No relative import at all.** An ESM `.ts` file cannot resolve a sibling
//     `./sanitize` without an extension, while this project's `tsc` config (commonjs,
//     `moduleResolution: node`, out of scope for 03-03) rejects a `.ts` specifier.
//     Staying a leaf is what lets the unit test load this module directly; the redactor
//     and the context reader are injected by the composition root instead of imported.

/** Nest's six levels, mirrored so this module stays independent of `@nestjs/common`. */
export type NestLogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

/** pino's own level names, which do not match Nest's 1:1 (see `NEST_TO_PINO`). */
export type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * `verbose` has no pino counterpart: Nest uses it below `debug`, pino's lowest level is
 * `trace`. Mapping it to `trace` keeps the ordering instead of dropping the call.
 */
export const NEST_TO_PINO: Record<NestLogLevel, PinoLevel> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

/** Verbosity rank, lowest first — `setLogLevels` resolves the set to one pino level. */
const PINO_ORDER: readonly PinoLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/**
 * The slice of pino this module uses: a settable level and one method per level, each
 * taking a single already-redacted record. The single-argument call is load-bearing —
 * pino does not redact its second (`msg`) argument, and this module's contract is that
 * *every* emitted string has been through the redactor, message included.
 */
export interface PinoLike {
  level: string;
  trace(payload: Record<string, unknown>): void;
  debug(payload: Record<string, unknown>): void;
  info(payload: Record<string, unknown>): void;
  warn(payload: Record<string, unknown>): void;
  error(payload: Record<string, unknown>): void;
  fatal(payload: Record<string, unknown>): void;
}

export interface LoggerCoreOptions {
  /**
   * The redactor applied to **every** emitted record. Required, not defaulted: a caller
   * that forgot it would silently emit raw secrets, so the type system — not a comment —
   * is what guarantees it. Production wires `sanitize()` from `./sanitize` here.
   */
  sanitize: (value: unknown) => unknown;
  /**
   * Where the per-line `requestId` comes from. Production passes `currentRequestId`;
   * the `undefined` default is all this module can guarantee without importing the
   * async-context module, and it simply omits the field.
   */
  getRequestId?: () => string | undefined;
}

/** The seven methods of Nest's `LoggerService`, with no Nest type in sight. */
export interface LoggerCore {
  log(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  debug(message: unknown, ...optionalParams: unknown[]): void;
  verbose(message: unknown, ...optionalParams: unknown[]): void;
  fatal(message: unknown, ...optionalParams: unknown[]): void;
  setLogLevels(levels: readonly NestLogLevel[]): void;
}

/** Builds the logger core: plain object, no decorators, no Nest, no I/O of its own. */
export function createLoggerCore(pino: PinoLike, options: LoggerCoreOptions): LoggerCore {
  const redact = options.sanitize;
  const getRequestId = options.getRequestId ?? ((): string | undefined => undefined);

  function emit(
    level: PinoLevel,
    message: unknown,
    optionalParams: readonly unknown[],
    flags: { allowStack?: boolean } = {},
  ): void {
    const params = [...optionalParams];
    const { stack, context, data } = splitParams(params, flags.allowStack === true);

    const record: Record<string, unknown> = {};
    if (typeof message === 'string') record.msg = message;
    if (context !== undefined) record.context = context;
    if (stack !== undefined) record.err = { stack };
    if (data.length === 1) record.data = data[0];
    else if (data.length > 1) record.data = data;

    // Non-string messages (objects, errors) are the data, never the msg field: pino would
    // otherwise stringify them with its own lossy `String()` fallback. A plain object is
    // spread so its keys stay top-level fields — that is what makes a line like the
    // startup record queryable by `port` instead of buried under `data`.
    if (typeof message !== 'string') {
      if (isPlainObject(message)) {
        Object.assign(record, message);
        if (data.length > 0) record.data = data.length === 1 ? data[0] : data;
      } else {
        record.data = data.length > 0 ? [message, ...data] : message;
      }
    }

    const requestId = getRequestId();
    if (requestId !== undefined) record.requestId = requestId;

    // One redaction call over the *composite* record — `msg`, the stack and whatever a
    // spread error object contributed included. Redacting field by field is how a payload
    // nested two levels deeper than the author looked gets through.
    const safe = redact(record) as Record<string, unknown>;

    switch (level) {
      case 'trace':
        pino.trace(safe);
        break;
      case 'debug':
        pino.debug(safe);
        break;
      case 'info':
        pino.info(safe);
        break;
      case 'warn':
        pino.warn(safe);
        break;
      case 'error':
        pino.error(safe);
        break;
      case 'fatal':
        pino.fatal(safe);
        break;
    }
  }

  return {
    log: (message, ...optionalParams) => emit('info', message, optionalParams),
    warn: (message, ...optionalParams) => emit('warn', message, optionalParams),
    error: (message, ...optionalParams) =>
      emit('error', message, optionalParams, { allowStack: true }),
    debug: (message, ...optionalParams) => emit('debug', message, optionalParams),
    verbose: (message, ...optionalParams) => emit('trace', message, optionalParams),
    fatal: (message, ...optionalParams) => emit('fatal', message, optionalParams),

    /**
     * pino has a single threshold, Nest hands us a set. Enabling `['error', 'warn']` must
     * silence `info`, so resolve to the most verbose level in the set; an empty set means
     * "log nothing".
     */
    setLogLevels(levels) {
      if (levels.length === 0) {
        pino.level = 'silent';
        return;
      }
      const mapped = levels.map((level) => NEST_TO_PINO[level] ?? 'info');
      pino.level = mapped.reduce((lowest, candidate) =>
        PINO_ORDER.indexOf(candidate) < PINO_ORDER.indexOf(lowest) ? candidate : lowest,
      );
    },
  };
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
 * strings are present; otherwise one trailing string is the context. Anything that is not
 * a string stays `data` and is never interpreted as position — a string message in a data
 * slot must not silently become the log context.
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
