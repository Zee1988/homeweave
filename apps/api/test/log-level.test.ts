import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LOG_LEVELS,
  OPTIONS_FILE_PATH,
  readOptionsFile,
  resolveLogLevel,
} from '../src/config/log-level.ts';

/** Runs `body` against a throwaway directory and always cleans it up. */
function withTempDir(body: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-log-level-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('LOG_LEVEL wins over the options file', () => {
  const result = resolveLogLevel({ LOG_LEVEL: 'debug' }, () => ({ log_level: 'warn' }));
  assert.deepEqual(result, { level: 'debug', source: 'env' });
});

test('an out-of-range LOG_LEVEL degrades to info instead of throwing', () => {
  const result = resolveLogLevel({ LOG_LEVEL: 'garbage' }, () => ({ log_level: 'debug' }));
  assert.deepEqual(result, { level: 'info', source: 'invalid' });
});

test('reads log_level from the Supervisor options file', () => {
  // `log_level` is the key the generator emits (config.yaml `options:` / `schema:`).
  assert.deepEqual(resolveLogLevel({}, () => ({ log_level: 'warn' })), {
    level: 'warn',
    source: 'options',
  });
});

test('also accepts the camelCase logLevel spelling', () => {
  assert.deepEqual(resolveLogLevel({}, () => ({ logLevel: 'debug' })), {
    level: 'debug',
    source: 'options',
  });
});

test('an out-of-range options value degrades to info', () => {
  assert.deepEqual(resolveLogLevel({}, () => ({ log_level: 'verbose' })), {
    level: 'info',
    source: 'invalid',
  });
});

test('falls back to info when the reader returns nothing', () => {
  assert.deepEqual(resolveLogLevel({}, () => null), { level: 'info', source: 'fallback' });
  assert.deepEqual(resolveLogLevel({}, () => ({})), { level: 'info', source: 'fallback' });
  assert.deepEqual(resolveLogLevel({}, () => 'not an object'), {
    level: 'info',
    source: 'fallback',
  });
});

test('a reader that throws does not escape', () => {
  const result = resolveLogLevel({}, () => {
    throw new Error('EACCES: permission denied');
  });
  assert.deepEqual(result, { level: 'info', source: 'fallback' });
});

test('the level list matches the options schema the Supervisor validates against', () => {
  assert.deepEqual([...LOG_LEVELS], ['info', 'debug', 'warn']);
  assert.equal(OPTIONS_FILE_PATH, '/data/options.json');
});

test('readOptionsFile returns null for a missing file, corrupt JSON and non-JSON', () => {
  assert.equal(readOptionsFile(path.join(tmpdir(), 'hw-does-not-exist-options.json')), null);

  withTempDir((dir) => {
    const corrupt = path.join(dir, 'options.json');
    writeFileSync(corrupt, '{ "log_level": "debug",');
    assert.equal(readOptionsFile(corrupt), null);

    const valid = path.join(dir, 'valid-options.json');
    writeFileSync(valid, '{ "log_level": "warn" }');
    assert.deepEqual(readOptionsFile(valid), { log_level: 'warn' });
  });
});
