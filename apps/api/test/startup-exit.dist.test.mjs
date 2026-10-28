import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Black-box proof of the exit-code contract from 03-05 Task 1 (threat T-03-09).
//
// The unit test (`startup-errors.test.ts`) pins the mapping; this file pins that the mapping
// is actually reached by the artefact the image ships. Those are different claims: a check
// that runs after `app.init()` never sees the failure it was written for (Prisma's
// `$connect()` throws first, and the reason degrades to `unexpected`/1), which is invisible
// to any test that calls `runStartupChecks` directly.
//
// 78 is EX_CONFIG: "your environment is wrong, fix the mount". 1 is "something broke".
// Both restart the container, so the exit code plus the `reason` field are the only way an
// operator can tell an unwritable `/data` from a crash.

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN_JS = join(API_ROOT, 'dist', 'main.js');
const EXIT_TIMEOUT_MS = 15_000;

const scratch = [];

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'homeweave-exit-'));
  scratch.push(dir);
  return dir;
}

/** Runs `dist/main.js` with the given overrides and resolves once it has exited on its own. */
function runToExit(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN_JS], {
      cwd: API_ROOT,
      // A clean env: inheriting PORT or DATABASE_URL from the developer's shell would make
      // these tests pass or fail depending on who runs them.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
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

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`process did not exit within ${EXIT_TIMEOUT_MS}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, EXIT_TIMEOUT_MS);

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** The last JSON object on stdout that carries an `event` field — the startup record. */
function startupRecord(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.includes('"event":'));
  assert.ok(lines.length > 0, `no structured startup record in stdout:\n${stdout}`);
  return JSON.parse(lines.at(-1));
}

test('a non-numeric PORT exits 78 with reason invalid_port', async () => {
  const { code, stdout } = await runToExit({
    PORT: 'not-a-number',
    DATABASE_URL: `file:${join(tempDir(), 'db.sqlite').replace(/\\/g, '/')}`,
  });

  assert.equal(code, 78, `expected EX_CONFIG, got ${code}\nstdout:\n${stdout}`);
  const record = startupRecord(stdout);
  assert.equal(record.event, 'startup_failed');
  assert.equal(record.reason, 'invalid_port');
  assert.equal(record.exitCode, 78);
});

test('a missing data directory exits 78 with reason dir_missing', async () => {
  // The regression this pins: the check must run BEFORE the Nest container is built.
  // Prisma's `$connect()` throws "Cannot open database because the directory does not
  // exist" inside `app.init()`, and any check placed after it reports
  // `reason: unexpected` / exit 1 — a stack trace instead of "your /data is not mounted".
  const missing = join(tempDir(), 'not-created', 'db.sqlite').replace(/\\/g, '/');

  const { code, stdout } = await runToExit({ PORT: '18101', DATABASE_URL: `file:${missing}` });

  assert.equal(code, 78, `expected EX_CONFIG, got ${code}\nstdout:\n${stdout}`);
  const record = startupRecord(stdout);
  assert.equal(record.reason, 'dir_missing');
  assert.equal(record.exitCode, 78);
});

test(
  'a read-only data directory exits 78 with reason dir_readonly',
  {
    // `chmod` cannot express "unwritable" on win32, and root ignores the mode bits, so in
    // both cases the write probe would succeed and the assertion would be about nothing.
    skip:
      process.platform === 'win32'
        ? 'chmod 0555 does not restrict writes on win32'
        : process.getuid?.() === 0
          ? 'root ignores the mode bits, so the write probe cannot fail'
          : false,
  },
  async () => {
    // The mount failure an HAOS install actually hits: the volume is root-owned while the
    // process runs as `node`. 03-05 chose "refuse to start" over "start and report 503" —
    // a process that cannot persist anything is not partially ready, and 78 + this reason
    // is what points the operator at the mount instead of at the code.
    const dir = tempDir();
    writeFileSync(join(dir, 'db.sqlite'), '');
    chmodSync(dir, 0o555);

    try {
      const { code, stdout } = await runToExit({
        PORT: '18103',
        DATABASE_URL: `file:${join(dir, 'db.sqlite').replace(/\\/g, '/')}`,
      });

      assert.equal(code, 78, `expected EX_CONFIG, got ${code}\nstdout:\n${stdout}`);
      const record = startupRecord(stdout);
      assert.equal(record.event, 'startup_failed');
      assert.equal(record.reason, 'dir_readonly');
      assert.equal(record.exitCode, 78);
    } finally {
      // The global `after` hook removes `tempDir()` with `rmSync(recursive)`, which cannot
      // descend into a 0555 directory on every filesystem.
      chmodSync(dir, 0o755);
    }
  },
);

test('a port already in use is exit 1, not a configuration verdict', async () => {
  // A busy port is a runtime condition, not a bad environment: the same config works as
  // soon as the other process is gone. Reporting 78 here would send the operator to edit
  // settings that are correct.
  const dbDir = tempDir();
  const env = {
    PORT: '18102',
    DATABASE_URL: `file:${join(dbDir, 'db.sqlite').replace(/\\/g, '/')}`,
  };

  const first = spawn(process.execPath, [MAIN_JS], {
    cwd: API_ROOT,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    // Wait for the first process to own the port, otherwise the second one could win the
    // race and this test would assert the wrong thing.
    await new Promise((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => reject(new Error('first process never started')), EXIT_TIMEOUT_MS);
      first.stdout.setEncoding('utf8');
      first.stdout.on('data', (chunk) => {
        seen += chunk;
        if (seen.includes('"event":"startup_ok"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      first.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(`first process exited early:\n${seen}`));
      });
    });

    const { code, stdout } = await runToExit(env);
    assert.equal(code, 1, `expected exit 1, got ${code}\nstdout:\n${stdout}`);
    assert.equal(startupRecord(stdout).reason, 'unexpected');
  } finally {
    first.kill('SIGKILL');
  }
});
