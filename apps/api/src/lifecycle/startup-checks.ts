import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { type AppConfig, MAX_PORT, MIN_PORT } from '../config/app-config';
import { ConfigError, StartupError } from '../config/errors';
import { checkDisk, type DiskCheckResult } from '../health/checks/disk.check';
import {
  compareMigrations,
  queryAppliedMigrations,
  readExpectedMigrations,
  type MigrationsStatus,
  type RawMigrationReader,
} from '../health/checks/migrations.check';
import type { WriteProbeState } from '../health/checks/database.check';

// The four startup checks (03-05 Task 1, threat T-03-09).
//
// The whole point is ordering: every check runs BEFORE `app.listen()`, so there is no
// window in which the port is open and the database is unusable. A Supervisor (or a
// human) that probes during that window would see a container that answers `/health/live`
// and writes nowhere, which is exactly the half-available state this plan removes.
//
// Why these exit codes: 78 (EX_CONFIG) says "your environment is wrong, fix it"; 1 says
// "something is broken". Both restart, but only 78 points at the mount that needs fixing.
//
// Deliberately free of `@nestjs/*` and I/O beyond what is injected: `startup-checks.test.ts`
// loads this through `--experimental-strip-types`, and each check must be drivable with a
// fake so the exit-code matrix is pinned without spawning a process.

export interface StartupCheckDeps {
  config: AppConfig;
  /**
   * Verdict of the write probe that already ran in `HealthModule` on module init.
   *
   * Handed in rather than performed here on purpose: the probe writes a real file into the
   * data directory, and the module that owns it (`STARTUP_PROBE`) has already run it once
   * during `NestFactory.create`. Probing a second time would write a second probe file and
   * could disagree with the state `/health/ready` replays — two probes, two answers, and
   * the operator has no way to tell which one the process acted on.
   */
  startupProbe: WriteProbeState;
  migrationsDir: string;
  prisma: RawMigrationReader;
  /** Injected for tests; the real default is the same `checkDisk` readiness uses. */
  disk?: (dir: string) => DiskCheckResult;
}

export interface StartupCheckResult {
  /** `ok` or `low`; low only warns (see below). */
  disk: DiskCheckResult;
  /** Diagnostic value for the startup log line — never a gate (D-06). */
  migrations: MigrationsStatus | 'unknown';
  migrationsDetail?: string;
}

export interface DataDirIo {
  exists(dir: string): boolean;
  isWritable(dir: string): boolean;
}

const defaultDataDirIo: DataDirIo = {
  exists: (dir) => existsSync(dir),
  isWritable: (dir) => {
    try {
      accessSync(dir, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * The two checks that need no container at all, run BEFORE `NestFactory.create`.
 *
 * This is not belt-and-braces: `PrismaService.onModuleInit` calls `$connect()`, and
 * better-sqlite3 throws `TypeError: Cannot open database because the directory does not
 * exist` while the container is still being built. That throw happens before any check
 * inside `runStartupChecks` can run, so a missing bind mount would be reported as
 * `reason: unexpected`, `exitCode: 1` — the operator gets a stack trace instead of "your
 * `/data` is not mounted". Running the two cheap file checks first is what makes 78
 * reachable for the failures that actually deserve it (threat T-03-09).
 */
export function assertDataDirWritable(dir: string, io: DataDirIo = defaultDataDirIo): void {
  if (!io.exists(dir)) {
    throw new ConfigError('dir_missing', `data directory ${dir} does not exist`);
  }
  if (!io.isWritable(dir)) {
    throw new ConfigError('dir_readonly', `data directory ${dir} is not writable by this user`);
  }
}

/** The directory the disk check and the write probe both look at. */
export function dataDirOf(config: Pick<AppConfig, 'databasePath'>): string {
  // `resolve` first: better-sqlite3 resolves a relative path against the cwd, so
  // `dirname('data/app.db')` would be `data` — a directory that only exists relative to
  // the cwd at the moment of the check.
  return dirname(resolve(config.databasePath));
}

/**
 * Runs the checks in short-circuit order and throws the error that decides the exit code.
 *
 * Returns (rather than throws) the two non-fatal results, because both belong in the
 * startup log line: a low-disk warning and the migrations diagnostic.
 */
export async function runStartupChecks(deps: StartupCheckDeps): Promise<StartupCheckResult> {
  const { config, startupProbe, prisma } = deps;
  const disk = deps.disk ?? ((dir: string) => checkDisk(dir));

  // 1. Configuration. `loadAppConfig` already rejects a bad PORT, but it runs before the
  //    container exists and this function is the last gate before `listen()` — a future
  //    caller that builds an AppConfig by hand must not be able to skip it.
  if (!Number.isInteger(config.port) || config.port < MIN_PORT || config.port > MAX_PORT) {
    throw new ConfigError(
      'invalid_port',
      `port must be an integer between ${MIN_PORT} and ${MAX_PORT}, got ${config.port}`,
    );
  }
  if (typeof config.databasePath !== 'string' || config.databasePath.trim().length === 0) {
    throw new ConfigError('database_path_empty', 'DATABASE_URL resolved to an empty path');
  }

  const dataDir = dataDirOf(config);

  // 2 & 3. Directory writability and the write probe, both already decided by the
  //        STARTUP_PROBE holder: it ran `access(W_OK)`, wrote and removed `.hw-write-probe`
  //        and issued `SELECT 1`. Its four reasons split across the two exit codes because
  //        only `query_failed` is not an environment problem.
  if (!startupProbe.ok) {
    switch (startupProbe.reason) {
      case 'dir_missing':
      case 'dir_readonly':
      case 'write_failed':
        throw new ConfigError(
          startupProbe.reason,
          `data directory ${dataDir} is not usable (${startupProbe.reason})`,
        );
      case 'query_failed':
      default:
        // A directory that is writable but whose database cannot answer is a broken
        // artifact (corrupt file, wrong format), not a mount the operator got wrong.
        throw new StartupError(
          'query_failed',
          `database at ${dataDir} did not answer a trivial query`,
        );
    }
  }

  // 4. Free space. Reported, never fatal: rebooting a container does not create space, so
  //    exiting here would turn a warning into a restart loop that fixes nothing. The disk
  //    check still gates `/health/ready`, which is where the Supervisor should react.
  const diskResult = disk(dataDir);

  // 5. Migrations are a diagnostic (D-06). Two very different situations hide behind
  //    "migrations are not ok":
  //      - the image has no `prisma/migrations` directory  → build defect, exit 1
  //      - the database has no `_prisma_migrations` table  → fresh volume, normal
  //    Only the first is a startup failure; conflating them would either refuse to boot a
  //    brand-new installation or silently serve an image that can never migrate.
  const expected = readExpectedMigrations(deps.migrationsDir);
  if (expected === null) {
    throw new StartupError(
      'migrations_unreadable',
      `migrations directory ${deps.migrationsDir} is missing from the image`,
    );
  }

  const applied = await queryAppliedMigrations(prisma);
  if (applied === null) {
    return { disk: diskResult, migrations: 'unknown', migrationsDetail: 'table_missing' };
  }

  const comparison = compareMigrations(expected, applied);
  return {
    disk: diskResult,
    migrations: comparison.status,
    migrationsDetail: comparison.pending.length > 0 ? `pending:${comparison.pending.length}` : undefined,
  };
}
