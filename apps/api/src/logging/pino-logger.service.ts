import { Injectable, type LogLevel, type LoggerService } from '@nestjs/common';
import pino, { type Logger as Pino } from 'pino';

import { createLoggerCore, type LoggerCore, type PinoLevel } from './logger-core';
import { currentRequestId } from './request-context';
import { sanitize } from './sanitize';

// Adapts pino to the NestJS `LoggerService` contract so every Nest internal log
// (bootstrap, route mapping, unhandled exceptions) goes through one structured writer.
//
// This file is now a thin `@Injectable()` wrapper: build the pino instance, hand it to
// `createLoggerCore()`, forward the seven methods. All behaviour — positional parsing,
// level mapping, redaction through `sanitize()`, `requestId` correlation — lives in
// `logger-core.ts`, where it is unit-testable without a Nest container. Do not add logic
// here: anything added below is invisible to `apps/api/test/logger-core.test.ts`.
//
// Deliberately absent, with reasons:
//   - NO `redact` config. pino's `redact` cannot express key-name blacklists at arbitrary
//     depth, value patterns (`Bearer ...`) or cycle protection, so it is not the answer to
//     D-03 (03-RESEARCH.md §5.2). Masking is `sanitize()`, applied in the core.
//   - NO pino transport. Writes are synchronous to stdout, so this phase never needs
//     `logger.flush()`; the 03-05 shutdown path must therefore not call it either
//     (a drain that has nothing to drain is a lie in the shutdown budget).

export interface PinoLoggerServiceOptions {
  /** Level for the process. Resolved once by `loadAppConfig()` and passed in. */
  level?: PinoLevel;
  /**
   * Injected writer. The repo's existing convention for untestable side effects is to
   * inject them as an optional parameter with the real implementation as the default
   * (`scripts/ci/build-image.mjs:56`, `scripts/lint-workspace.mjs:105`).
   */
  pino?: Pino;
}

@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly core: LoggerCore;

  constructor(options: PinoLoggerServiceOptions = {}) {
    const instance =
      options.pino ??
      pino({
        level: options.level ?? 'info',
        // `base` carries the stable identity of the emitter; the HA Supervisor collects
        // stdout from several apps, so an unprefixed line is unattributable.
        base: { service: 'homeweave-api' },
        // Fixed-width ISO timestamps sort correctly as text when the Supervisor tails
        // the log with `--no-timestamps`, which is what the operator copy/pastes.
        timestamp: pino.stdTimeFunctions.isoTime,
      });

    // The composition root: the core itself imports neither of these (see the header of
    // `logger-core.ts`), so forgetting one is a compile error at this single call site
    // rather than a silently unsanitised log line.
    this.core = createLoggerCore(instance, { sanitize, getRequestId: currentRequestId });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.core.log(message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.core.warn(message, ...optionalParams);
  }

  /** Nest's calling convention is `(message, stack?, context?)`; see the core's parser. */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.core.error(message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.core.debug(message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.core.verbose(message, ...optionalParams);
  }

  /** Same name as pino's `fatal` on purpose — do not fold it into `error`. */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.core.fatal(message, ...optionalParams);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.core.setLogLevels(levels);
  }
}
