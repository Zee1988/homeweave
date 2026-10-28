import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Black-box test against the built output, not against imported source. Decorator
// metadata (`design:paramtypes`) is only emitted by `tsc`, so a test that imported
// `src/*.ts` through `--experimental-strip-types` would load a Nest module graph with
// no metadata and fail in a way that says nothing about production. Spawning
// `dist/main.js` is also the only way to prove the artefact the image runs actually
// boots (03-PATTERNS.md "No Analog Found", `probe-prisma-engine.test.mjs` style).

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN_JS = join(API_ROOT, 'dist', 'main.js');

// Port choice: the plan asks for `PORT=0` (kernel-assigned) and a fixed fallback. The
// committed `resolvePort()` rejects 0 as out of range [1,65535] — deliberately, since a
// container told to listen on 0 would print a port no watchdog ever probes (ConfigError,
// 03-05 exit code 78). So the fallback port is used up front, and the real port is still
// parsed out of the startup record: if a future change makes 0 legal, the parsing path
// already handles it.
const FALLBACK_PORT = 18099;
const STARTUP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

let child;
let tmpDir;
let stdout = '';
let stderr = '';

/** The startup record's port, if it has been printed yet. */
function portFromStartupRecord() {
  const match = /"port":(\d+)/.exec(stdout);
  return match === null ? undefined : Number(match[1]);
}

function describeChild() {
  return `child stdout:\n${stdout || '(empty)'}\nchild stderr:\n${stderr || '(empty)'}`;
}

async function waitForLive() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // A crashed child would otherwise be indistinguishable from a slow one, and the
    // failure would be a 10 s timeout instead of the actual stderr.
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API exited before serving /health/live\n${describeChild()}`);
    }

    const port = portFromStartupRecord() ?? Number(process.env.HEALTH_TEST_PORT ?? FALLBACK_PORT);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`);
      return { response, port };
    } catch {
      // Connection refused while the process is still mapping its routes.
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`/health/live did not answer within ${STARTUP_TIMEOUT_MS}ms\n${describeChild()}`);
}

before(() => {
  // The database lives in the OS temp directory, not in the repo: better-sqlite3 fails
  // with SQLITE_CANTOPEN if the parent directory does not exist, and a `./.tmp/` inside
  // apps/api would either need a .gitignore rule or leak into `git status`.
  tmpDir = mkdtempSync(join(tmpdir(), 'homeweave-live-'));
  const databaseUrl = `file:${join(tmpDir, 'live-test.db').replace(/\\/g, '/')}`;

  child = spawn(process.execPath, [MAIN_JS], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      PORT: String(process.env.HEALTH_TEST_PORT ?? FALLBACK_PORT),
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
});

after(async () => {
  try {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // A leaked child would keep the port bound and make the next run fail for unrelated
    // reasons, so "the process is gone" is asserted, not assumed. `exitCode` is null for
    // any signal-terminated child by Node's definition — SIGTERM therefore shows up in
    // `signalCode`. Asserting `exitCode !== null` alone would only hold once 03-05 adds
    // `enableShutdownHooks`, which turns SIGTERM into a graceful exit(0).
    assert.ok(
      child === undefined || child.exitCode !== null || child.signalCode !== null,
      `API child process is still running after SIGTERM\n${describeChild()}`,
    );
  } finally {
    if (tmpDir !== undefined) rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GET /health/live returns 200 and nothing but { status: "ok" }', async () => {
  const { response, port } = await waitForLive();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type')?.includes('application/json'), true);

  const body = await response.json();

  // The whole point of the route: the body is a literal. A version, build SHA, absolute
  // path, hostname, uptime or dependency list would turn an unauthenticated endpoint
  // into a scanner's fingerprint (threat T-03-01), so the key set is asserted exactly.
  assert.deepEqual(Object.keys(body), ['status']);
  assert.deepEqual(body, { status: 'ok' });

  // The startup record must name the resolved port, database path and log level — the
  // operator's only way to see which of the three sources the level came from.
  assert.equal(portFromStartupRecord(), port, `startup record does not carry port ${port}`);
  assert.match(stdout, /"databasePath":"[^"]+"/);
  assert.match(stdout, /"logLevel":"(?:info|debug|warn)"/);
  assert.match(stdout, /"logLevelSource":"(?:env|options|invalid|fallback)"/);
});
