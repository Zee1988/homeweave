import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APPLIED_MIGRATIONS_SQL,
  compareMigrations,
  MIGRATIONS_TABLE,
  queryAppliedMigrations,
  readExpectedMigrations,
  type AppliedMigrationRow,
} from '../src/health/checks/migrations.check.ts';

// The comparison matrix of 03-04 Task 1: all-applied / missing row / interrupted row /
// unknown source. These tests exist because the migrations field is DIAGNOSTIC ONLY
// (D-06) — it can never fail readiness, so the only place its correctness can be pinned
// down is here. A wrong `pending` count would be invisible in production: ready would
// keep answering 200 either way.

const REAL_MIGRATIONS_DIR = fileURLToPath(new URL('../prisma/migrations', import.meta.url));

function row(migration_name: string, finished_at: number | null): AppliedMigrationRow {
  return { migration_name, finished_at };
}

test('every expected migration applied -> ok with nothing pending or failed', () => {
  // `finished_at` values are epoch ms, exactly as RESEARCH §4.5 measured them on
  // `apps/api/.tmp/verify.db` — not ISO strings.
  const result = compareMigrations(
    ['20261028000037_init', '20261029000000_add_setting'],
    [row('20261028000037_init', 1793146203798), row('20261029000000_add_setting', 1793146300000)],
  );

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.failed, []);
});

test('an expected migration with no row -> pending, and the name is reported', () => {
  const result = compareMigrations(
    ['20261028000037_init', '20261029000000_add_setting'],
    [row('20261028000037_init', 1793146203798)],
  );

  assert.equal(result.status, 'pending');
  assert.deepEqual(result.pending, ['20261029000000_add_setting']);
  assert.deepEqual(result.failed, []);
});

test('a row with finished_at === null -> pending, and it is reported as failed', () => {
  // Interrupted migration: the row exists but the DDL may be half-applied. Counting it as
  // "applied" because the row is present would be the classic wrong answer.
  const result = compareMigrations(['20261028000037_init'], [row('20261028000037_init', null)]);

  assert.equal(result.status, 'pending');
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.failed, ['20261028000037_init']);
});

test('unknown source: a missing migrations directory returns null instead of throwing', () => {
  const absent = join(tmpdir(), 'homeweave-migrations-does-not-exist');

  assert.equal(readExpectedMigrations(absent), null);
});

test('unknown source: a missing _prisma_migrations table returns null instead of throwing', async () => {
  // What Prisma actually raises on a fresh volume, wrapped so the message looks nothing
  // like a shape this module special-cases.
  const prisma = {
    $queryRawUnsafe: async () => {
      throw new Error('no such table: main._prisma_migrations');
    },
  };

  assert.equal(await queryAppliedMigrations(prisma), null);
});

test('the directory reader ignores migration_lock.toml and returns names sorted', () => {
  // A real directory on disk, not a fixture: `readdirSync(..., { withFileTypes: true })`
  // is the behaviour under test (files must not be mistaken for migrations).
  const dir = mkdtempSync(join(tmpdir(), 'homeweave-migrations-'));
  try {
    mkdirSync(join(dir, '20261029000000_second'));
    mkdirSync(join(dir, '20261028000037_init'));
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "sqlite"\n', 'utf8');

    assert.deepEqual(readExpectedMigrations(dir), ['20261028000037_init', '20261029000000_second']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shipped prisma/migrations directory is readable and carries at least one migration', () => {
  // Guards the other direction of the unknown path: if the directory were resolved from
  // the wrong cwd, every environment would silently report `unknown` and nobody would
  // notice. This is the same path resolution the readiness check uses at runtime.
  const expected = readExpectedMigrations(REAL_MIGRATIONS_DIR);

  assert.notEqual(expected, null);
  assert.ok((expected ?? []).length >= 1, `no migrations found under ${REAL_MIGRATIONS_DIR}`);
});

test('the query adapter reads the documented table and normalises rows', async () => {
  let seenQuery = '';
  const prisma = {
    $queryRawUnsafe: async (query: string) => {
      seenQuery = query;
      return [
        { migration_name: '20261028000037_init', finished_at: 1793146203798 },
        // A driver that hands `finished_at` back as a bigint-style string must not be read
        // as "finished" by accident.
        { migration_name: '20261029000000_add_setting', finished_at: '1793146300000' },
        { migration_name: '20261030000000_half', finished_at: null },
        { not_a_migration_row: true },
      ];
    },
  };

  const rows = await queryAppliedMigrations(prisma);

  assert.match(seenQuery, new RegExp(MIGRATIONS_TABLE));
  assert.equal(seenQuery, APPLIED_MIGRATIONS_SQL);
  assert.deepEqual(rows, [
    { migration_name: '20261028000037_init', finished_at: 1793146203798 },
    { migration_name: '20261029000000_add_setting', finished_at: 1793146300000 },
    { migration_name: '20261030000000_half', finished_at: null },
  ]);

  // End to end over the normalised rows. The interrupted row alone forces `pending` even
  // when every expected migration is applied — which is the assertion that would catch a
  // comparison that only diffs expected-vs-applied and forgets `finished_at IS NULL`.
  const comparison = compareMigrations(
    ['20261028000037_init', '20261029000000_add_setting'],
    rows ?? [],
  );

  assert.equal(comparison.status, 'pending');
  assert.deepEqual(comparison.pending, []);
  assert.deepEqual(comparison.failed, ['20261030000000_half']);
});
