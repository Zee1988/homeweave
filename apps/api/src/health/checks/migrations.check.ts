import { readdirSync } from 'node:fs';

// The migrations dimension of readiness.
//
// Scope of record: 03-CONTEXT.md decision D-06 (user-approved) — this is a DIAGNOSTIC
// field ONLY. It never contributes to the HTTP status code. ROADMAP SC-2's second clause
// ("unfinished migration -> non-2xx") is deliberately NOT implemented, because the image
// ships without the Prisma CLI (`prisma` is a devDependency; Dockerfile:110 installs with
// `--prod`), so a non-2xx here would put an unmigrated database into an unbreakable
// restart loop: the watchdog (>= 300 == unhealthy) would kill the process before an
// operator could ever run `migrate deploy` from the host. This file must therefore never
// be cited as proof that RT-02 is fully delivered.
//
// The comparison itself needs no CLI: the expected migration names are read straight off
// the directory shipped into the image (COPY prisma ./prisma, Dockerfile:104) and the
// applied rows come from SQLite's `_prisma_migrations` table
// (03-RESEARCH.md §4.5 — `finished_at` is unix epoch MILLISECONDS, not an ISO string).
//
// No `@nestjs/*` import here, and no decorators: this module must stay loadable by
// `node --experimental-strip-types` so the comparison matrix can be unit tested without a
// container (03-PATTERNS.md "No Analog Found" — the shape is taken from
// `scripts/**`'s "return a structured result" contract).

/** Mirrors RESEARCH §6.2. `unknown` is not a failure — it means "this database cannot
 *  say", which is the honest answer for a fresh volume or a pruned image. */
export type MigrationsStatus = 'ok' | 'pending' | 'unknown';

export interface AppliedMigrationRow {
  migration_name: string;
  /** Unix epoch ms; `null` means the row was written but never finished. */
  finished_at: number | null;
}

export interface MigrationComparison {
  status: MigrationsStatus;
  /** Expected migrations with no row at all. */
  pending: string[];
  /** Rows that exist but were interrupted (`finished_at IS NULL`). */
  failed: string[];
}

/**
 * The subset of the Prisma client this module touches. Structural on purpose: the unit
 * tests pass a plain object, and no generated client type is imported into a module that
 * `--experimental-strip-types` has to load.
 */
export interface RawMigrationReader {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export const MIGRATIONS_TABLE = '_prisma_migrations';

/** The one query this module runs. Kept as a constant so the prohibition on exposing SQL
 *  in the readiness body (T-03-07) has a single place to point at. */
export const APPLIED_MIGRATIONS_SQL = `SELECT migration_name, finished_at FROM "${MIGRATIONS_TABLE}"`;

/**
 * Expected migration names, taken from `prisma/migrations/`.
 *
 * Returns `null` — never throws — when the directory is absent: the production image may
 * be built without `prisma/`, and readiness must degrade to `unknown` rather than 500
 * (03-04-PLAN.md prohibition). `migration_lock.toml` is a regular file, so
 * `isDirectory()` already filters it out; the explicit filter below keeps that true even
 * if a future Prisma version writes directories that are not migrations.
 */
export function readExpectedMigrations(migrationsDir: string): string[] | null {
  let entries;
  try {
    entries = readdirSync(migrationsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The pure comparison. `unknown` is not produced here — it is a property of the sources
 * (no directory / no table), which the caller decides before calling this.
 */
export function compareMigrations(
  expectedNames: readonly string[],
  appliedRows: readonly AppliedMigrationRow[],
): MigrationComparison {
  const applied = new Map<string, number | null>();
  for (const row of appliedRows) applied.set(row.migration_name, row.finished_at);

  const pending = expectedNames.filter((name) => !applied.has(name)).sort();
  const failed = appliedRows
    .filter((row) => row.finished_at === null)
    .map((row) => row.migration_name)
    .sort();

  // An interrupted row counts as pending, not as `ok`: `finished_at IS NULL` means the
  // DDL for that migration may be half-applied (RESEARCH §4.5's判据).
  const status: MigrationsStatus = pending.length === 0 && failed.length === 0 ? 'ok' : 'pending';

  return { status, pending, failed };
}

/**
 * Reads the applied rows, mapping *every* failure to `null`.
 *
 * The blanket catch is the point, not laziness: `_prisma_migrations` is absent on a fresh
 * volume, absent again after a `rm data/*.db`, and unreadable while the database is
 * locked. None of those may turn a diagnostic field into a 500 (prohibition: "不得因迁移
 * 目录缺失而抛异常"). A genuinely broken query therefore shows up as `unknown` — the same
 * signal as a fresh database — which is why `pending`/`unknown` are logged at boot by
 * 03-05 rather than being inferred from this field alone.
 */
export async function queryAppliedMigrations(
  prisma: RawMigrationReader,
): Promise<AppliedMigrationRow[] | null> {
  let rows: unknown;
  try {
    rows = await prisma.$queryRawUnsafe<unknown>(APPLIED_MIGRATIONS_SQL);
  } catch {
    return null;
  }

  if (!Array.isArray(rows)) return [];

  const normalized: AppliedMigrationRow[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const name = record.migration_name;
    if (typeof name !== 'string') continue;

    const rawFinished = record.finished_at;
    const finished = rawFinished === null || rawFinished === undefined ? null : Number(rawFinished);

    normalized.push({
      migration_name: name,
      finished_at: finished === null || Number.isNaN(finished) ? null : finished,
    });
  }

  return normalized;
}
