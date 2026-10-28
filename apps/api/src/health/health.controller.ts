import { Controller, Get } from '@nestjs/common';

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
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
