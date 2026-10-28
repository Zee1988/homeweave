import { accessSync, constants, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Database dimension of readiness.
//
// Split into two halves on purpose (03-04-PLAN.md Task 2 / threat T-03-08):
//
//   probeWritableOnce() — runs ONCE, at startup. Access check, a real write into the data
//     directory, and one query. It is the only part that touches the filesystem for write.
//   checkDatabase()     — runs on every ready request, and only ever issues `SELECT 1`.
//
// Why the write probe is not per-request: SQLite in WAL mode creates `-wal`/`-shm` side
// files next to the database on the first write of a connection, so a per-request write
// probe would produce checkpoint churn on a 5-second probe interval, and would report a
// spurious failure on a read-only replica that is perfectly able to answer reads. The
// result of the startup probe is remembered and replayed, which also lets readiness say
// "this directory was not writable when the process started" — the truthful statement,
// since nothing has changed it since.
//
// The write probe writes into the data directory itself (not `/tmp`): a read-only data
// volume with a writable overlay would otherwise pass a probe that proves nothing about
// whether the database can persist.
//
// No `@nestjs/*` import and no decorators: loaded directly by `--experimental-strip-types`
// in `disk-check.test.ts`.

/** The temporary file the probe creates and removes. Dot-prefixed so a crashed probe's
 *  leftover is obvious in `ls -a` and cannot be mistaken for a migration. */
export const WRITE_PROBE_FILENAME = '.hw-write-probe';

/** Distinguishes the four ways the startup probe can fail. Each maps to a different
 *  operator action, so collapsing them into one message would defeat the purpose. */
export type WriteProbeReason = 'dir_missing' | 'dir_readonly' | 'write_failed' | 'query_failed';

/** Remembered outcome of the startup probe, injected into the readiness aggregator. */
export interface WriteProbeState {
  ok: boolean;
  reason?: WriteProbeReason;
}

/**
 * What the `STARTUP_PROBE` provider resolves to: mutable state plus a Nest lifecycle hook.
 *
 * A plain object rather than an `@Injectable()` class so this file stays free of
 * `@nestjs/*` — `--experimental-strip-types` cannot load decorators or the metadata they
 * need, and these reason mappings are exactly what the unit tests must pin down. Nest
 * calls `onModuleInit` on factory-provided instances just like class instances.
 */
export interface StartupProbeHolder {
  state: WriteProbeState;
  onModuleInit(): Promise<void>;
}

export interface DatabaseCheckResult {
  status: 'ok' | 'fail';
  /** A readable phrase, never an error message, a path, or a driver's own text
   *  (threat T-03-07: this lands in an unauthenticated response body). */
  reason?: string;
}

/** The subset of the Prisma client used here. Structural so tests pass a plain object. */
export interface StartupQueryRunner {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** Only the syscalls the probe needs, so a permissions failure can be simulated. */
export interface ProbeIo {
  exists: (path: string) => boolean;
  access: (path: string, mode: number) => void;
  writeFile: (path: string, data: string) => void;
  unlink: (path: string) => void;
}

export const defaultProbeIo: ProbeIo = {
  exists: (path) => existsSync(path),
  access: (path, mode) => accessSync(path, mode),
  writeFile: (path, data) => writeFileSync(path, data, { encoding: 'utf8', flag: 'w' }),
  unlink: (path) => unlinkSync(path),
};

export class WriteProbeError extends Error {
  reason: WriteProbeReason;

  constructor(reason: WriteProbeReason) {
    super(`database write probe failed: ${reason}`);
    this.name = 'WriteProbeError';
    this.reason = reason;
  }
}

/**
 * Startup-only write probe. Throws `WriteProbeError` carrying the reason; the caller
 * (the provider factory in `health.module.ts`) catches it and remembers the reason rather
 * than letting it escape — a non-writable data volume must not prevent the process from
 * answering readiness, it must make readiness answer 503 with a cause.
 */
export async function probeWritableOnce(
  prisma: StartupQueryRunner,
  dir: string,
  io: ProbeIo = defaultProbeIo,
): Promise<void> {
  if (!io.exists(dir)) throw new WriteProbeError('dir_missing');

  // `access(W_OK)` before writing: it separates "the mode bits say read-only" (the common
  // Supervisor-mounts-/data-as-root case, 03-VALIDATION.md A2) from a write that fails
  // for some other reason, and it fails without leaving anything behind.
  try {
    io.access(dir, constants.W_OK);
  } catch {
    throw new WriteProbeError('dir_readonly');
  }

  const probePath = join(dir, WRITE_PROBE_FILENAME);
  try {
    io.writeFile(probePath, 'ok\n');
  } catch {
    throw new WriteProbeError('write_failed');
  }

  // Remove it immediately; a leftover probe file in the data volume would be copied by
  // the next backup and show up in every `ls` until someone wondered what it was.
  try {
    io.unlink(probePath);
  } catch {
    // A probe file that cannot be deleted still proved the directory is writable. Not a
    // failure of readiness — but it does mean the volume is full or misconfigured enough
    // that unlink failed, and the disk check is the place that reports that.
  }

  try {
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch {
    throw new WriteProbeError('query_failed');
  }
}

const PROBE_REASON_PHRASES: Record<WriteProbeReason, string> = {
  dir_missing: 'database directory missing',
  dir_readonly: 'database directory not writable',
  write_failed: 'database write probe failed',
  query_failed: 'database query failed',
};

/** Default for the per-request query. Two seconds is longer than any local SQLite
 *  `SELECT 1` and short enough that a hung probe still answers inside a Supervisor
 *  watchdog interval. */
export const DEFAULT_DATABASE_TIMEOUT_MS = 2_000;

class QueryTimeoutError extends Error {
  constructor() {
    super('database query timed out');
    this.name = 'QueryTimeoutError';
  }
}

/**
 * Per-request database check: one read query, no writes, no filesystem access.
 *
 * The startup probe's verdict is replayed rather than repeated — see the header comment.
 */
export async function checkDatabase(
  prisma: StartupQueryRunner,
  startupProbe: WriteProbeState | undefined = undefined,
  options: { timeoutMs?: number } = {},
): Promise<DatabaseCheckResult> {
  if (startupProbe !== undefined && !startupProbe.ok) {
    const reason = startupProbe.reason ?? 'write_failed';
    return { status: 'fail', reason: PROBE_REASON_PHRASES[reason] };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DATABASE_TIMEOUT_MS;

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRawUnsafe('SELECT 1'),
      new Promise<never>((_resolve, reject) => {
        // Deliberately NOT unref'd. An unref'd timer does not keep the event loop alive,
        // so a hung query would leave the loop with nothing to schedule and the timeout
        // would never fire — the probe would be cancelled rather than answered. The timer
        // is cleared in `finally`, which is what bounds the process's lifetime here.
        timer = setTimeout(() => reject(new QueryTimeoutError()), timeoutMs);
      }),
    ]);
  } catch (error) {
    return {
      status: 'fail',
      reason: error instanceof QueryTimeoutError ? 'database query timed out' : 'database query failed',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  return { status: 'ok' };
}
