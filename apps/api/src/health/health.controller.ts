import { Controller, Get, Inject, Logger, Req, Res } from '@nestjs/common';

import { ShutdownState } from '../lifecycle/shutdown-state';
import { currentRequestId } from '../logging/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  DATABASE_DIR,
  MIGRATIONS_DIR,
  runChecks,
  STARTUP_PROBE,
  type ReadinessChecks,
} from './health-checks';
import type { StartupProbeHolder } from './checks/database.check';

/** The only slice of the Express response this controller needs. Declared structurally so
 *  no `@types/express` import is required for one method call. */
interface StatusWriter {
  status(code: number): unknown;
}

/** Ready body. Deliberately no uptime, no version, no host name, no path, no SQL: this
 *  endpoint is unauthenticated (threat T-03-07). */
interface ReadyBody {
  status: 'ok' | 'degraded';
  checks: ReadinessChecks | Record<string, never>;
}

// Liveness plus readiness.
//
// `/health/live` answers exactly one question — "is this process still able to serve
// HTTP?" — and it must never touch the database, the disk or the build metadata
// (03-RESEARCH.md §6.2, threat T-03-01). Two reasons that constraint is hard:
//   1. The Supervisor watchdog treats any status >= 300 as unhealthy and restarts the
//      app. A DB-backed liveness probe therefore cannot distinguish "the app is dead"
//      from "the database is momentarily locked", so a shutdown window becomes a
//      restart loop (03-PATTERNS.md 陷阱 6).
//   2. The endpoint is unauthenticated. Returning a version, build SHA, absolute path,
//      hostname or uptime hands a scanner a fingerprint and a view of the disk layout.
//      The body is a hardcoded literal for that reason — no env reads, no file reads.
//
// `/health/ready` is the opposite trade: it is the only route allowed to touch Prisma,
// the filesystem and the migration directory, and it is the only route that returns a
// non-2xx. The two paths share nothing but this class — separate methods, separate
// failure modes, no common helper that could throw on both (prohibition: "不得让 live 与
// ready 共用一个会抛异常的代码路径").
@Controller('health')
export class HealthController {
  /**
   * Nest's own `Logger`, not an injected logger: it forwards to whatever instance
   * `app.useLogger()` installed (the pino service), and resolving it statically needs no
   * provider in `HealthModule` — which keeps 03-01's module wiring untouched.
   */
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shutdownState: ShutdownState,
    @Inject(DATABASE_DIR) private readonly databaseDir: string,
    @Inject(MIGRATIONS_DIR) private readonly migrationsDir: string,
    @Inject(STARTUP_PROBE) private readonly startupProbe: StartupProbeHolder,
  ) {}

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

  /**
   * Readiness. Status codes come from `runChecks()` and nowhere else: 200 when the
   * database answers and the volume has room, 503 otherwise. `migrations` is reported but
   * cannot influence the code (D-06) — it is a diagnostic, not a gate.
   *
   * During shutdown the answer is an immediate 503 with an empty `checks` object: at that
   * point `PrismaService.onModuleDestroy` may already have closed the connection, so
   * running the checks would produce a misleading "database query failed" instead of the
   * true "this instance is going away".
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: StatusWriter): Promise<ReadyBody> {
    if (this.shutdownState.shuttingDown) {
      res.status(503);
      this.logger.debug({ requestId: currentRequestId() }, 'readiness probed during shutdown');
      return { status: 'degraded', checks: {} };
    }

    const report = await runChecks({
      prisma: this.prisma,
      databaseDir: this.databaseDir,
      migrationsDir: this.migrationsDir,
      startupProbe: this.startupProbe,
    });

    res.status(report.httpStatus);

    // The detail an operator needs goes to the log; the body keeps only enumerations and
    // counts. `reason` phrases are our own strings, never a driver message (T-03-07).
    const detail = {
      httpStatus: report.httpStatus,
      database: report.checks.database,
      migrations: report.checks.migrations,
      disk: report.checks.disk,
      requestId: currentRequestId(),
    };

    if (report.httpStatus === 503) {
      this.logger.warn(detail, 'readiness degraded');
    } else {
      this.logger.debug(detail, 'readiness ok');
    }

    return { status: report.status, checks: report.checks };
  }
}
