import {
  checkDatabase,
  type DatabaseCheckResult,
  type StartupProbeHolder,
  type StartupQueryRunner,
} from './checks/database.check';
import { checkDisk, type DiskCheckResult } from './checks/disk.check';
import {
  compareMigrations,
  queryAppliedMigrations,
  readExpectedMigrations,
  type MigrationsStatus,
  type RawMigrationReader,
} from './checks/migrations.check';

// The readiness aggregator (03-04 Task 3).
//
// It answers one question — "can this process serve requests right now?" — and its output
// has two halves that must not be confused:
//
//   `status` / `checks`  the report an operator reads (RESEARCH §6.2's shape)
//   `httpStatus`         the only thing the Supervisor acts on
//
// The single most important line in this file is the `httpStatus` expression: `migrations`
// is absent from it ON PURPOSE (D-06). Every other check can fail readiness; the migration
// count cannot, because the image has no `prisma` CLI and a non-2xx there produces an
// unbreakable restart loop rather than a fixable container. See
// `checks/migrations.check.ts`'s header for the full rationale.
//
// No `@nestjs/*` import and no decorators here either: the aggregator is plain async code
// so it can be exercised without a Nest container.

/** Directory the database file lives in — shared by the write probe and the disk check so
 *  both look at the volume the adapter actually opened. */
export const DATABASE_DIR = Symbol('HOMEWeave:databaseDir');

/** `prisma/migrations` inside the image (`COPY prisma ./prisma`, Dockerfile:104). */
export const MIGRATIONS_DIR = Symbol('HOMEWeave:migrationsDir');

/** The startup write probe's remembered verdict, provided once per process. */
export const STARTUP_PROBE = Symbol('HOMEWeave:startupProbe');

export interface MigrationsCheckResult {
  status: MigrationsStatus;
  /** Counts only — never the names, which are file paths from the image's build. */
  pending?: number;
  failed?: number;
  reason?: 'dir_missing' | 'table_missing' | 'read_failed';
}

export interface ReadinessChecks {
  database: DatabaseCheckResult;
  migrations: MigrationsCheckResult;
  disk: DiskCheckResult;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  checks: ReadinessChecks;
  /** 200 when ready, 503 when not. 500 is never used: it reads as "a bug in the app",
   *  while 503 says "a dependency is unavailable" (RESEARCH §6.3). */
  httpStatus: 200 | 503;
}

export interface ReadinessDeps {
  prisma: StartupQueryRunner & RawMigrationReader;
  databaseDir: string;
  migrationsDir: string;
  startupProbe: StartupProbeHolder;
}

async function checkMigrations(deps: ReadinessDeps): Promise<MigrationsCheckResult> {
  const expected = readExpectedMigrations(deps.migrationsDir);
  // A pruned image (or a wrong cwd) is `unknown`, not a failure and certainly not a 500.
  if (expected === null) return { status: 'unknown', reason: 'dir_missing' };

  const applied = await queryAppliedMigrations(deps.prisma);
  // `null` covers both "no `_prisma_migrations` table" (fresh volume) and "the read
  // failed". They are the same actionable state: this database cannot say.
  if (applied === null) return { status: 'unknown', reason: 'table_missing' };

  const comparison = compareMigrations(expected, applied);

  return {
    status: comparison.status,
    pending: comparison.pending.length,
    failed: comparison.failed.length,
  };
}

/**
 * Runs the three checks concurrently and reduces them to a report plus a status code.
 *
 * `allSettled`, not `all`: a rejected check must degrade its own dimension, never collapse
 * the report into a single opaque 503. That is the difference this plan is about — an
 * operator needs to know *which* dependency is unhappy, and the response body is the only
 * channel an unauthenticated probe has.
 */
export async function runChecks(deps: ReadinessDeps): Promise<ReadinessReport> {
  const [database, migrations, disk] = await Promise.allSettled([
    checkDatabase(deps.prisma, deps.startupProbe.state),
    checkMigrations(deps),
    // Wrapped so a synchronous throw inside `checkDisk` still lands in `allSettled`.
    Promise.resolve().then(() => checkDisk(deps.databaseDir)),
  ]);

  const databaseCheck: DatabaseCheckResult =
    database.status === 'fulfilled'
      ? database.value
      : { status: 'fail', reason: 'database query failed' };

  const migrationsCheck: MigrationsCheckResult =
    migrations.status === 'fulfilled'
      ? migrations.value
      : { status: 'unknown', reason: 'read_failed' };

  const diskCheck: DiskCheckResult =
    disk.status === 'fulfilled'
      ? disk.value
      : { status: 'low', freeBytes: 0, reason: 'stat_failed' };

  const httpStatus: 200 | 503 =
    databaseCheck.status === 'fail' || diskCheck.status === 'low' ? 503 : 200;

  const report: ReadinessReport = {
    status: httpStatus === 200 ? 'ok' : 'degraded',
    checks: {
      database: databaseCheck,
      migrations: migrationsCheck,
      disk: diskCheck,
    },
    httpStatus,
  };

  return report;
}
