import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Proves the shutdown path of 03-05 Task 2 against the built output: Nest's handler chain
// runs, both hooks fire in the documented order, and the process leaves with exit 0.
//
// Signal delivery itself is not exercised here — see the note in the harness. On win32 a
// real SIGTERM terminates the process without running handlers, so this would be
// unobservable; the emitted event is what Nest listens to either way.

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HARNESS = join(API_ROOT, 'test', 'fixtures', 'shutdown-harness.cjs');
const BUDGET_MS = 8000;
const HARD_TIMEOUT_MS = 20_000;

const scratch = [];

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'homeweave-shutdown-'));
  scratch.push(dir);
  return dir;
}

function runHarness(port, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [HARNESS], {
      cwd: API_ROOT,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PORT: String(port),
        DATABASE_URL: `file:${join(tempDir(), 'db.sqlite').replace(/\\/g, '/')}`,
        LOG_LEVEL: 'info',
        HARNESS_SIGNAL_DELAY_MS: String(options.signalDelayMs ?? 250),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let held;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;

      // A connection that is opened and then never sends anything is what a stuck client
      // looks like: `server.close()` waits for it, so the drain never finishes.
      if (options.holdSocket && held === undefined && stdout.includes('"event":"startup_ok"')) {
        held = connect(port, '127.0.0.1');
        held.on('error', () => undefined);
        if (typeof options.onSocket === 'function') options.onSocket(held);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      held?.destroy();
      reject(new Error(`shutdown did not finish within ${HARD_TIMEOUT_MS}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, HARD_TIMEOUT_MS);

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      held?.destroy();
      resolve({ code, signal, elapsedMs: Date.now() - startedAt, stdout, stderr });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      held?.destroy();
      reject(error);
    });
  });
}

/** Index of the first log line containing `needle`, or -1. */
function lineIndex(stdout, needle) {
  return stdout
    .split(/\r?\n/)
    .findIndex((line) => line.includes(needle));
}

/** Epoch milliseconds from the `time` field of the first line containing `needle`. */
function recordTime(stdout, needle) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.includes(needle));
  assert.ok(line !== undefined, `no log line containing "${needle}"\nstdout:\n${stdout}`);
  const match = /"time":"([^"]+)"/.exec(line);
  assert.ok(match !== null, `the line has no timestamp: ${line}`);
  return Date.parse(match[1]);
}

test('SIGTERM drains, logs both hooks in order, and exits 0', async () => {
  const { code, signal, elapsedMs, stdout, stderr } = await runHarness(18104);

  assert.equal(code, 0, `expected a graceful exit 0, got code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.equal(signal, null);

  const stop = lineIndex(stdout, 'shutdown: stop accepting new requests');
  const disconnect = lineIndex(stdout, 'shutdown: prisma disconnected');

  assert.ok(stop >= 0, `the "stop accepting" line is missing\nstdout:\n${stdout}`);
  assert.ok(disconnect >= 0, `the "prisma disconnected" line is missing\nstdout:\n${stdout}`);

  // The order is the contract: the flag flips (and the line is written) before the
  // connection goes away, so a request that was already accepted still finds a database.
  assert.ok(
    stop < disconnect,
    `"prisma disconnected" was logged before "stop accepting new requests"\nstdout:\n${stdout}`,
  );

  // Both lines carry the signal that caused them, which is what makes a restart loop
  // diagnosable from the log alone.
  assert.match(stdout.split(/\r?\n/)[stop], /SIGTERM/);

  // The 8 s budget is a backstop, not the normal path: a drain that takes longer than the
  // budget means this test should fail, not silently pass at the deadline.
  assert.ok(
    elapsedMs < BUDGET_MS,
    `shutdown took ${elapsedMs}ms, at or over the ${BUDGET_MS}ms budget`,
  );
  assert.ok(
    !stdout.includes('shutdown_forced'),
    `the budget backstop fired on a normal drain\nstdout:\n${stdout}`,
  );

  // The startup record still precedes everything, i.e. the app really was serving.
  assert.equal(lineIndex(stdout, '"event":"startup_ok"') >= 0, true, `no startup record\nstdout:\n${stdout}`);
});

test('a drain that cannot finish exits at the 8 s budget with exit 0, not SIGKILL', async () => {
  // The scenario the budget exists for: a client that connects and goes silent keeps
  // `server.close()` waiting, so the hooks never complete and Nest never reaches
  // `process.exit`. Without the backstop the container would sit there until the
  // Supervisor's SIGKILL — the one outcome the 8 s budget is chosen to beat.
  const { code, signal, stdout } = await runHarness(18105, {
    holdSocket: true,
    signalDelayMs: 800,
  });

  assert.equal(code, 0, `expected exit 0 from the backstop, got code=${code} signal=${signal}\nstdout:\n${stdout}`);
  assert.equal(signal, null, 'the process must exit on its own, never by SIGKILL');

  assert.match(stdout, /shutdown_forced/, `the backstop did not log\nstdout:\n${stdout}`);

  // Measured from the shutdown line, not from spawn: the budget starts when the signal is
  // handled, and `elapsedMs` also carries boot time plus the harness's deliberate delay.
  // This is the number that has to beat `docker stop`'s 10 s.
  const beganAt = recordTime(stdout, 'shutdown: stop accepting new requests');
  const forcedAt = recordTime(stdout, 'shutdown_forced');
  const drainMs = forcedAt - beganAt;

  assert.ok(
    drainMs >= BUDGET_MS - 500 && drainMs <= BUDGET_MS + 1500,
    `the backstop fired ${drainMs}ms after the shutdown began, not at the ${BUDGET_MS}ms budget\nstdout:\n${stdout}`,
  );

  // A forced exit means the drain did not complete, so the connection was never released
  // and "prisma disconnected" must NOT be claimed.
  assert.equal(
    lineIndex(stdout, 'shutdown: prisma disconnected'),
    -1,
    `a stalled drain must not report a clean disconnect\nstdout:\n${stdout}`,
  );
});
