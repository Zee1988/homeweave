import { Controller, Get, Logger, Req } from '@nestjs/common';

import { currentRequestId } from '../logging/request-context';

// Liveness only. `/health/live` answers exactly one question — "is this process still
// able to serve HTTP?" — and it must never touch the database, the disk or the build
// metadata (03-RESEARCH.md §6.2, threat T-03-01).
//
// Two reasons that constraint is hard:
//   1. The Supervisor watchdog treats any status >= 300 as unhealthy and restarts the
//      app. A DB-backed liveness probe therefore cannot distinguish "the app is dead"
//      from "the database is momentarily locked", so a shutdown window becomes a
//      restart loop (03-PATTERNS.md 陷阱 6).
//   2. The endpoint is unauthenticated. Returning a version, build SHA, absolute path,
//      hostname or uptime hands a scanner a fingerprint and a view of the disk layout.
//      The body is a hardcoded literal for that reason — no env reads, no file reads.
//
// 03-04 adds `@Get('ready')` to this same controller, next to `live()`, so that the
// Phase 5 "exempt health routes from auth" change stays a single local edit.
@Controller('health')
export class HealthController {
  /**
   * Nest's own `Logger`, not an injected logger: it forwards to whatever instance
   * `app.useLogger()` installed (the pino service), and resolving it statically needs no
   * provider in `HealthModule` — which keeps 03-01's module wiring untouched.
   */
  private readonly logger = new Logger(HealthController.name);

  @Get('live')
  live(@Req() req: { method?: string; path?: string }): { status: 'ok' } {
    // One `debug` line, added in 03-03 so a request can be tied to its log lines by id
    // (the e2e test in `redaction-e2e.dist.test.mjs` is the only consumer; at the default
    // `info` level this line is not emitted). Deliberately no headers and no body: this
    // route is unauthenticated, so a probe's Authorization header is the caller's
    // business, and the liveness path must stay free of request-shaped data.
    this.logger.debug({
      method: req.method,
      path: req.path,
      requestId: currentRequestId(),
    });

    return { status: 'ok' };
  }
}
