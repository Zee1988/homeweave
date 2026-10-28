import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  checkDatabase,
  DEFAULT_DATABASE_TIMEOUT_MS,
  probeWritableOnce,
  WRITE_PROBE_FILENAME,
  WriteProbeError,
  type ProbeIo,
  type WriteProbeReason,
} from '../src/health/checks/database.check.ts';
import {
  checkDisk,
  DEFAULT_DISK_MIN_FREE_BYTES,
  resolveDiskThreshold,
  type DiskIo,
} from '../src/health/checks/disk.check.ts';

// Threat T-03-08's tests: "the directory is not writable" and "the disk is nearly full"
// must be two distinguishable outcomes, and the free-byte number must be the one the
// operator can act on. The checks take their syscalls by injection for exactly this
// reason — a test that chmod'd a real directory would be a no-op on Windows, and the
// failure it claims to cover would silently pass everywhere.

function fakeIo(overrides: Partial<DiskIo> = {}): DiskIo {
  return {
    exists: () => true,
    statfs: () => ({ bsize: 4096, bavail: 1000 }),
    ...overrides,
  };
}

test('freeBytes is bsize * bavail — not bsize * bfree', () => {
  // `bavail` (available to an unprivileged process) is what `USER node` can actually use;
  // `bfree` includes the root reserve and would overstate the headroom.
  const result = checkDisk('/data', 1024, fakeIo({ statfs: () => ({ bsize: 4096, bavail: 1000 }) }));

  assert.deepEqual(result, { status: 'ok', freeBytes: 4_096_000 });
});

test('free space below the threshold -> low, carrying the measured freeBytes', () => {
  const result = checkDisk('/data', 4_096_001, fakeIo({ statfs: () => ({ bsize: 4096, bavail: 1000 }) }));

  assert.equal(result.status, 'low');
  assert.equal(result.freeBytes, 4_096_000);
  // No `reason`: the number itself is the actionable part for an "almost full" volume.
  assert.equal(result.reason, undefined);
});

test('exactly at the threshold is ok — the comparison is "below", not "at or below"', () => {
  const result = checkDisk('/data', 4_096_000, fakeIo());

  assert.equal(result.status, 'ok');
});

test('a missing data directory is reported as dir_missing, distinct from a full disk', () => {
  const result = checkDisk('/data/does-not-exist', 1024, fakeIo({ exists: () => false }));

  assert.deepEqual(result, { status: 'low', freeBytes: 0, reason: 'dir_missing' });
});

test('statfs failing is its own reason, not folded into dir_missing', () => {
  const io = fakeIo({
    statfs: () => {
      throw new Error('EIO: i/o error, statfs');
    },
  });

  const result = checkDisk('/data', 1024, io);

  assert.deepEqual(result, { status: 'low', freeBytes: 0, reason: 'stat_failed' });
});

test('the threshold defaults to 10 MiB and can be overridden by DISK_MIN_FREE_BYTES', () => {
  assert.equal(DEFAULT_DISK_MIN_FREE_BYTES, 10 * 1024 * 1024);
  assert.equal(resolveDiskThreshold({}), 10 * 1024 * 1024);
  assert.equal(resolveDiskThreshold({ DISK_MIN_FREE_BYTES: '4096' }), 4096);
  assert.equal(resolveDiskThreshold({ DISK_MIN_FREE_BYTES: '0' }), 0);

  // A malformed add-on option must not throw inside readiness: it falls back, and the
  // fact that it fell back is visible in the startup record, not in a 500.
  assert.equal(resolveDiskThreshold({ DISK_MIN_FREE_BYTES: 'not-a-number' }), 10 * 1024 * 1024);
  assert.equal(resolveDiskThreshold({ DISK_MIN_FREE_BYTES: '-1' }), 10 * 1024 * 1024);

  // End to end through the env-sourced default: the override really does decide the verdict.
  const io = fakeIo({ statfs: () => ({ bsize: 1, bavail: 5_000 }) });
  const previous = process.env.DISK_MIN_FREE_BYTES;

  try {
    process.env.DISK_MIN_FREE_BYTES = '10485760';
    assert.equal(checkDisk('/data', resolveDiskThreshold(), io).status, 'low');
    process.env.DISK_MIN_FREE_BYTES = '1024';
    assert.equal(checkDisk('/data', resolveDiskThreshold(), io).status, 'ok');
  } finally {
    if (previous === undefined) delete process.env.DISK_MIN_FREE_BYTES;
    else process.env.DISK_MIN_FREE_BYTES = previous;
  }
});

function probeIo(overrides: Partial<ProbeIo> = {}): ProbeIo {
  return {
    exists: () => true,
    access: () => undefined,
    writeFile: () => undefined,
    unlink: () => undefined,
    ...overrides,
  };
}

const okPrisma = { $queryRawUnsafe: async () => [{ 1: 1 }] };

async function expectProbeReason(run: () => Promise<void>, reason: WriteProbeReason): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof WriteProbeError, `expected WriteProbeError, got ${String(error)}`);
    assert.equal(error.reason, reason);
    return true;
  });
}

test('write probe: a missing directory -> dir_missing', async () => {
  await expectProbeReason(
    () => probeWritableOnce(okPrisma, '/data', probeIo({ exists: () => false })),
    'dir_missing',
  );
});

test('write probe: a read-only directory -> dir_readonly (access(W_OK) fails first)', async () => {
  await expectProbeReason(
    () =>
      probeWritableOnce(
        okPrisma,
        '/data',
        probeIo({
          access: () => {
            throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
          },
        }),
      ),
    'dir_readonly',
  );
});

test('write probe: access() succeeding but the write failing -> write_failed', async () => {
  // The two are genuinely different: a directory can be `access`-able and still refuse a
  // file creation (quota, immutable attribute, full volume), and the operator action
  // differs.
  await expectProbeReason(
    () =>
      probeWritableOnce(
        okPrisma,
        '/data',
        probeIo({
          writeFile: () => {
            throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
          },
        }),
      ),
    'write_failed',
  );
});

test('write probe: the write succeeds but SELECT 1 fails -> query_failed', async () => {
  await expectProbeReason(
    () =>
      probeWritableOnce(
        {
          $queryRawUnsafe: async () => {
            throw new Error('SQLITE_CANTOPEN: unable to open database file');
          },
        },
        '/data',
        probeIo(),
      ),
    'query_failed',
  );
});

test('write probe: a writable directory leaves no probe file behind', async () => {
  // A real directory, real fs calls: the point is that the file is created inside the data
  // directory and then removed, so the next backup does not ship it.
  const dir = mkdtempSync(join(tmpdir(), 'homeweave-probe-'));
  const probePath = join(dir, WRITE_PROBE_FILENAME);
  let sawExistingFileDuringWrite = false;

  try {
    await probeWritableOnce(okPrisma, dir, {
      exists: (path) => existsSync(path),
      access: () => undefined,
      writeFile: (path, data) => {
        // Prove the probe writes into the data directory itself, not into os.tmpdir().
        assert.equal(path, probePath);
        assert.equal(data, 'ok\n');
        writeFileSync(path, data);
        sawExistingFileDuringWrite = existsSync(probePath);
      },
      unlink: (path) => {
        unlinkSync(path);
      },
    });

    assert.equal(sawExistingFileDuringWrite, true);
    assert.equal(existsSync(probePath), false, 'probe file was left behind in the data directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('per-request check: a healthy database is ok and issues exactly one read query', async () => {
  const queries: string[] = [];
  const prisma = {
    $queryRawUnsafe: async (query: string) => {
      queries.push(query);
      return [{ 1: 1 }];
    },
  };

  const result = await checkDatabase(prisma);

  assert.deepEqual(result, { status: 'ok' });
  assert.deepEqual(queries, ['SELECT 1']);
  // The prohibition: readiness must never write. A write probe would show up here as a
  // second statement or as a non-SELECT.
  assert.equal(
    queries.every((query) => query.trim().toUpperCase().startsWith('SELECT')),
    true,
  );
});

test('per-request check: an unreachable database is fail with a readable phrase', async () => {
  const result = await checkDatabase({
    $queryRawUnsafe: async () => {
      throw new Error('SQLITE_BUSY: database is locked');
    },
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.reason, 'database query failed');
  // T-03-07: the driver's message must not reach the response body.
  assert.doesNotMatch(String(result.reason), /SQLITE|locked|prisma|SELECT/i);
});

test('per-request check: a hung query fails on the timeout instead of hanging the probe', async () => {
  const started = Date.now();
  const result = await checkDatabase(
    { $queryRawUnsafe: () => new Promise(() => undefined) },
    undefined,
    { timeoutMs: 20 },
  );
  const elapsed = Date.now() - started;

  assert.equal(result.status, 'fail');
  assert.equal(result.reason, 'database query timed out');
  assert.ok(elapsed < 1_000, `timeout took ${elapsed}ms`);
  assert.equal(DEFAULT_DATABASE_TIMEOUT_MS, 2_000);
});

test('per-request check: a failed startup probe is replayed as fail, without re-probing', async () => {
  let queried = false;
  const prisma = {
    $queryRawUnsafe: async () => {
      queried = true;
      return [{ 1: 1 }];
    },
  };

  const readonly = await checkDatabase(prisma, { ok: false, reason: 'dir_readonly' });
  assert.deepEqual(readonly, { status: 'fail', reason: 'database directory not writable' });

  const missing = await checkDatabase(prisma, { ok: false, reason: 'dir_missing' });
  assert.deepEqual(missing, { status: 'fail', reason: 'database directory missing' });

  // Nothing was re-probed: the write probe is a startup-only operation (prohibition:
  // "不得在每次 /health/ready 调用时写库").
  assert.equal(queried, false);

  // A probe that never ran is not a failure — that is the state during a unit test or a
  // container that wires the checks without the startup probe.
  const notRun = await checkDatabase({ $queryRawUnsafe: async () => [{ 1: 1 }] }, { ok: true });
  assert.deepEqual(notRun, { status: 'ok' });
});

test('no reason phrase leaks a path, SQL or driver name (T-03-07)', async () => {
  const phrases: string[] = [];
  for (const reason of ['dir_missing', 'dir_readonly', 'write_failed', 'query_failed'] as const) {
    const result = await checkDatabase(
      { $queryRawUnsafe: async () => [{ 1: 1 }] },
      { ok: false, reason },
    );
    phrases.push(String(result.reason));
  }

  assert.equal(phrases.length, 4);
  assert.equal(new Set(phrases).size, 4, 'the four probe reasons must map to four distinct phrases');
  for (const phrase of phrases) {
    assert.doesNotMatch(phrase, /\/data|[A-Za-z]:\\|SELECT|prisma|SQLITE/i);
  }
});
