import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Black-box readiness tests against the built artefact, one spawned process per scenario
// so ports, database files and the startup write probe cannot leak between them
// (03-04-PLAN.md Task 4). Spawning `dist/main.js` rather than importing `src/*.ts` is the
// same choice `health-live.dist.test.mjs` makes: decorator metadata only exists after
// `tsc`, and the artefact the image runs is the one under test.
//
// What each scenario is really proving:
//   A  a fresh volume is READY, and `migrations: unknown` does not make it unready
//      (that is D-06 asserted behaviourally, not just in a comment)
//   B  a migrated database reports `migrations: ok`
//   C  a read-only data directory answers 503, with a body that carries no path, no SQL
//      and no driver name (T-03-07). Windows cannot express "read-only directory", so it
//      is skipped there — see the skip reason, and 03-VALIDATION.md A2.
//   D  the same 503 path driven by free space instead of permissions, which is
//      expressible on every platform — this is the scenario that actually observes the
//      503 mapping and the body's non-leakiness on this machine.
//   E  the compiled status-code expression never mentions `migrations` (D-06 guard).

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN_JS = join(API_ROOT, 'dist', 'main.js');
// `apps/api/.tmp/` is a gitignored local artefact of `prisma migrate deploy`, never a
// committed fixture (03-04-PLAN.md 已知残余风险). Scenario B reports SKIPPED when it is
// absent instead of inventing one.
const VERIFY_DB = join(API_ROOT, '.tmp', 'verify.db');

const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spawns the API and waits until `/health/ready` answers (either code — a 503 is a valid
 * answer here; the point of waiting is that the process is listening).
 */
async function startServer(t, { port, databaseUrl, extraEnv = {} }) {
  const child = spawn(process.execPath, [MAIN_JS], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: 'info',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const describe = () => `child stdout:\n${stdout || '(empty)'}\nchild stderr:\n${stderr || '(empty)'}`;

  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    child.kill('SIGTERM');
    // 03-05 adds `enableShutdownHooks`; until then SIGTERM is not graceful, so both
    // "exited" and "killed by signal" are acceptable — a leaked child is not.
    const exited = await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      sleep(5_000).then(() => false),
    ]);
    if (!exited) child.kill('SIGKILL');
  });

  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: response.status, headers: response.headers, body: await response.json() };
  };

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API exited before serving /health/ready (port ${port})\n${describe()}`);
    }
    try {
      await get('/health/ready');
      return { get, describe };
    } catch {
      // Connection refused while the process is still mapping its routes.
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`/health/ready did not answer within ${STARTUP_TIMEOUT_MS}ms\n${describe()}`);
}

/** T-03-07: nothing in an unauthenticated readiness body may describe the host. */
function assertNoInternalDetail(body, scenario) {
  const text = JSON.stringify(body);

  assert.doesNotMatch(text, /\/data/, `${scenario}: body leaks the data path`);
  assert.doesNotMatch(text, /SELECT/i, `${scenario}: body leaks SQL`);
  assert.doesNotMatch(text, /prisma/i, `${scenario}: body leaks the driver name`);
  assert.doesNotMatch(text, /[A-Za-z]:\\\\|[A-Za-z]:\\/, `${scenario}: body leaks an absolute path`);
  assert.doesNotMatch(text, /at \w+ \(/, `${scenario}: body leaks a stack trace`);
  assert.doesNotMatch(text, /SQLITE/i, `${scenario}: body leaks a driver error code`);
}

function assertBodyShape(body, scenario) {
  assert.deepEqual(
    Object.keys(body).sort(),
    ['checks', 'status'],
    `${scenario}: the body has exactly status + checks`,
  );
}

/** A database URL pointing into `dir`, in the form better-sqlite3 accepts. */
function databaseUrlFor(dir, filename) {
  return `file:${join(dir, filename).replace(/\\/g, '/')}`;
}

test('A: a fresh volume is ready, and migrations:unknown does not gate it (D-06)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'homeweave-ready-a-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // No `prisma migrate deploy` against this file: `$connect` creates it empty, which is
  // exactly the "wrong volume, operator has not migrated yet" state readiness must
  // survive without entering a restart loop.
  const server = await startServer(t, { port: 18100, databaseUrl: databaseUrlFor(dir, 'ready-ok.db') });
  const { status, body } = await server.get('/health/ready');

  assert.equal(status, 200, `expected 200 on a fresh volume\n${server.describe()}`);
  assertBodyShape(body, 'A');
  assert.equal(body.status, 'ok');

  assert.equal(body.checks.database.status, 'ok');
  assert.equal(body.checks.disk.status, 'ok');
  assert.ok(body.checks.disk.freeBytes > 0, 'freeBytes must be measured, not defaulted');

  // The point of the scenario: an empty database has no `_prisma_migrations` table, so the
  // migration dimension cannot say anything — and readiness is 200 regardless. Asserting
  // both facts together is the behavioural statement of D-06.
  assert.equal(body.checks.migrations.status, 'unknown');
  assert.equal(status, 200);

  assertNoInternalDetail(body, 'A');

  // SC-1 regression guard: adding `ready` must not have grown `live`'s body.
  const live = await server.get('/health/live');
  assert.equal(live.status, 200);
  assert.deepEqual(Object.keys(live.body), ['status']);
  assert.deepEqual(live.body, { status: 'ok' });
});

test(
  'B: a migrated database reports migrations:ok',
  { skip: existsSync(VERIFY_DB) ? false : `${VERIFY_DB} is a gitignored local artefact; run prisma migrate deploy to create it` },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'homeweave-ready-b-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    // Copied into the OS temp directory: the plan forbids treating `apps/api/.tmp/` as a
    // fixture, and the child must not write its `-wal` next to the original.
    const target = join(dir, 'ready-migrated.db');
    copyFileSync(VERIFY_DB, target);

    const server = await startServer(t, { port: 18101, databaseUrl: databaseUrlFor(dir, 'ready-migrated.db') });
    const { status, body } = await server.get('/health/ready');

    assert.equal(status, 200, `expected 200 on a migrated database\n${server.describe()}`);
    assert.equal(body.checks.migrations.status, 'ok');
    assert.equal(body.checks.migrations.pending, 0);
    assert.equal(body.checks.migrations.failed, 0);
    assertNoInternalDetail(body, 'B');
  },
);

test(
  'C: a read-only data directory answers 503 without leaking the host',
  {
    skip:
      process.platform === 'win32'
        ? 'chmod 0555 does not restrict writes on win32 — unverified here, tracked as 03-VALIDATION.md A2'
        : false,
  },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'homeweave-ready-c-'));
    // The database file itself must pre-exist and stay writable so that `$connect` can
    // open it: the failure under test is the DIRECTORY not being writable (which is what
    // the startup write probe detects), not the file being unopenable.
    writeFileSync(join(dir, 'readonly.db'), '');
    chmodSync(dir, 0o555);

    t.after(() => {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    });

    const server = await startServer(t, { port: 18102, databaseUrl: databaseUrlFor(dir, 'readonly.db') });
    const { status, body } = await server.get('/health/ready');

    assert.equal(status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.checks.database.status, 'fail');
    assert.match(String(body.checks.database.reason), /not writable|directory missing|write probe/);
    assertNoInternalDetail(body, 'C');
  },
);

test('D: a volume below DISK_MIN_FREE_BYTES answers 503 with the disk dimension blamed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'homeweave-ready-d-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // A threshold no filesystem can satisfy. This exercises the same 503 path as scenario C
  // — including the no-leak assertions — on every platform, which matters because C
  // cannot run on win32 and an unexercised branch is an unverified branch.
  const server = await startServer(t, {
    port: 18103,
    databaseUrl: databaseUrlFor(dir, 'low-disk.db'),
    extraEnv: { DISK_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) },
  });
  const { status, body } = await server.get('/health/ready');

  assert.equal(status, 503);
  assertBodyShape(body, 'D');
  assert.equal(body.status, 'degraded');

  // The 503 is attributable: the disk is `low` while the database is still fine. A single
  // opaque failure would have made these two indistinguishable.
  assert.equal(body.checks.disk.status, 'low');
  assert.equal(body.checks.disk.freeBytes > 0, true);
  assert.equal(body.checks.database.status, 'ok');

  assertNoInternalDetail(body, 'D');
});

test('E: the status-code decision never consults migrations (D-06)', () => {
  // Source-level guard for the one prohibition that cannot be observed from a response:
  // a future edit could add `|| migrations.status === 'pending'` and every scenario above
  // would still pass on a healthy database.
  const source = readFileSync(join(API_ROOT, 'dist', 'health', 'health-checks.js'), 'utf8');
  const decision = source
    .split('\n')
    .find((line) => line.includes('httpStatus') && line.includes('503'));

  assert.ok(decision !== undefined, 'no httpStatus decision found in dist/health/health-checks.js');
  assert.doesNotMatch(decision, /migrations/);
  assert.match(decision, /databaseCheck/);
  assert.match(decision, /diskCheck/);
});
