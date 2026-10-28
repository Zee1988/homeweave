import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// End-to-end proof of D-03 (threat T-03-05): a credential that arrives in a request must
// not appear in the process's stdout, and a request must be findable in the log stream by
// its `x-request-id`.
//
// Black-box on purpose — it spawns `dist/main.js` and reads the real stdout. A test that
// imported the logger would prove `sanitize()` works on a fixture; only this one proves
// the *pipeline* (middleware → AsyncLocalStorage → logger core → sanitize → pino → fd 1)
// does not drop a field on the way.

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN_JS = join(API_ROOT, 'dist', 'main.js');

// 18098, not 18099: `pnpm test` may run this file and `health-live.dist.test.mjs`
// concurrently in separate processes, and two children cannot bind the same port.
const FALLBACK_PORT = 18098;
const STARTUP_TIMEOUT_MS = 10_000;
const LOG_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

const BEARER = 'test-token-12345';
const COOKIE_VALUE = 'abc123';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let child;
let tmpDir;
let stdout = '';
let stderr = '';

function describeChild() {
  return `child stdout:\n${stdout || '(empty)'}\nchild stderr:\n${stderr || '(empty)'}`;
}

function portFromStartupRecord() {
  const match = /"port":(\d+)/.exec(stdout);
  return match === null ? undefined : Number(match[1]);
}

/** Every JSON record pino has written so far. */
function logRecords() {
  const records = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // A partially flushed line; the next poll will pick it up whole.
    }
  }
  return records;
}

async function waitForLive() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API exited before serving /health/live\n${describeChild()}`);
    }

    const port = portFromStartupRecord() ?? Number(process.env.REDACTION_TEST_PORT ?? FALLBACK_PORT);
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

/** The `debug` line the controller writes for one request, once pino has flushed it. */
async function waitForRequestLine(requestId) {
  const deadline = Date.now() + LOG_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const found = logRecords().find(
      (record) => record.requestId === requestId && record.path === '/health/live',
    );
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`no log line carries requestId ${requestId}\n${describeChild()}`);
}

function liveUrl(port) {
  return `http://127.0.0.1:${port}/health/live`;
}

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'homeweave-redaction-'));
  const databaseUrl = `file:${join(tmpDir, 'redaction-test.db').replace(/\\/g, '/')}`;

  child = spawn(process.execPath, [MAIN_JS], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      PORT: String(process.env.REDACTION_TEST_PORT ?? FALLBACK_PORT),
      DATABASE_URL: databaseUrl,
      // `debug`, because the correlation line is a debug line by design (03-03).
      LOG_LEVEL: 'debug',
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

    assert.ok(
      child === undefined || child.exitCode !== null || child.signalCode !== null,
      `API child process is still running after SIGTERM\n${describeChild()}`,
    );
  } finally {
    if (tmpDir !== undefined) rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a bearer token and a cookie value sent to the API never reach stdout', async () => {
  const { port } = await waitForLive();

  const response = await fetch(liveUrl(port), {
    headers: {
      authorization: `Bearer ${BEARER}`,
      cookie: `session=${COOKIE_VALUE}`,
    },
  });

  assert.equal(response.status, 200);
  // Let the child finish writing the line this request produced before reading stdout.
  await waitForRequestLine(response.headers.get('x-request-id'));

  assert.ok(
    !stdout.includes(BEARER),
    `stdout contains the raw bearer token\n${describeChild()}`,
  );
  assert.ok(
    !stdout.includes(COOKIE_VALUE),
    `stdout contains the raw cookie value\n${describeChild()}`,
  );
});

test('the response carries a uuid x-request-id and its log line carries the same id', async () => {
  const { port } = await waitForLive();

  const response = await fetch(liveUrl(port));
  const requestId = response.headers.get('x-request-id');

  assert.ok(requestId !== null, 'the response has no x-request-id header');
  assert.match(requestId, UUID_SHAPE, `x-request-id is not a uuid: ${requestId}`);

  // The body is untouched by this phase (SC-1 / T-03-01): one key, one literal value.
  assert.deepEqual(await response.json(), { status: 'ok' });

  const line = await waitForRequestLine(requestId);
  assert.equal(line.requestId, requestId);
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/health/live');

  // "Correlated" means every line that names this request carries the field, not just the
  // one line the controller writes: a line with the id buried in `msg` and no `requestId`
  // cannot be joined to the others.
  const mentioning = logRecords().filter((record) => JSON.stringify(record).includes(requestId));
  assert.ok(mentioning.length >= 1, `no log line mentions ${requestId}`);
  for (const record of mentioning) {
    assert.equal(record.requestId, requestId, `a line mentions ${requestId} without carrying it`);
  }

  // The startup record was written outside any request scope, which is the other half of
  // the same claim: the context is per-request, not process-global.
  const startup = logRecords().find((record) => record.msg === undefined && record.port !== undefined);
  assert.ok(startup !== undefined, `the startup record is missing\n${describeChild()}`);
  assert.equal('requestId' in startup, false, 'the startup record leaked a requestId');
});

test('a well-formed inbound x-request-id is reused, so an upstream trace survives', async () => {
  const { port } = await waitForLive();
  const inbound = 'supervisor-span-4f9c';

  const response = await fetch(liveUrl(port), { headers: { 'x-request-id': inbound } });

  assert.equal(response.headers.get('x-request-id'), inbound);
  const line = await waitForRequestLine(inbound);
  assert.equal(line.requestId, inbound);
});

test('a malformed or oversized inbound x-request-id is replaced with a fresh uuid', async () => {
  const { port } = await waitForLive();

  // A path-traversal payload, a value carrying a space and slashes, and something past the
  // 64-char limit: each would be written verbatim into every line of the request if
  // trusted. (A newline is a fourth case, but `fetch` refuses to transmit one at all —
  // that hazard is closed in the client and in the middleware's character class.)
  const rejected = ['../evil.txt', '../../etc/passwd', 'x'.repeat(65)];

  for (const inbound of rejected) {
    const response = await fetch(liveUrl(port), { headers: { 'x-request-id': inbound } });
    const requestId = response.headers.get('x-request-id');

    assert.notEqual(requestId, inbound, `the server echoed the rejected id ${JSON.stringify(inbound)}`);
    assert.match(requestId, UUID_SHAPE, `expected a uuid for ${JSON.stringify(inbound)}`);
  }

  assert.ok(!stdout.includes('../evil.txt'), 'a traversal payload reached stdout');
  assert.ok(!stdout.includes('x'.repeat(65)), 'an oversized id reached stdout');
});
