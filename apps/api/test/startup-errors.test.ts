import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ConfigError,
  EXIT_CONFIG,
  EXIT_STARTUP,
  StartupError,
  toStartupFailure,
} from '../src/config/errors.ts';

// Pins the exit-code mapping from 03-05 Task 1 (threat T-03-09).
//
// Worth a test because every wrong answer is invisible locally: the process dies either
// way, the suite stays green, and the mistake only shows up as a Supervisor restart loop on
// someone's Home Assistant box. The only observable difference is the (exit code, reason)
// pair, so that pair is asserted.
//
// Only `errors.ts` is imported here — it has no imports of its own. The checks themselves
// live in `startup-checks.ts`, whose module graph uses extensionless specifiers that Node's
// `--experimental-strip-types` cannot resolve; those are covered end-to-end instead, by
// `test/startup-exit.dist.test.mjs` spawning the built `dist/main.js`.

describe('toStartupFailure', () => {
  it('maps a ConfigError to 78 and keeps its reason', () => {
    assert.deepEqual(toStartupFailure(new ConfigError('dir_readonly', 'nope')), {
      reason: 'dir_readonly',
      exitCode: EXIT_CONFIG,
      message: 'nope',
    });
  });

  it('maps a StartupError to 1 and keeps its reason', () => {
    assert.deepEqual(toStartupFailure(new StartupError('query_failed', 'garbage file')), {
      reason: 'query_failed',
      exitCode: EXIT_STARTUP,
      message: 'garbage file',
    });
  });

  it('never blames the configuration for an unknown throw', () => {
    // A defect must not be reported as a misconfiguration: that sends the operator to edit
    // settings that were already correct, and hides a real crash behind "fix your env".
    const failure = toStartupFailure(new TypeError('boom'));
    assert.equal(failure.exitCode, EXIT_STARTUP);
    assert.equal(failure.reason, 'unexpected');
    assert.match(failure.message, /TypeError: boom/);
  });

  it('survives a non-Error throw', () => {
    assert.deepEqual(toStartupFailure('plain string'), {
      reason: 'unexpected',
      exitCode: EXIT_STARTUP,
      message: 'plain string',
    });
  });

  it('falls back to the reason when no message is given', () => {
    // A throw site that forgets the message must not produce an empty `msg` field, which
    // would leave the log line unsearchable.
    assert.equal(new ConfigError('dir_missing').message, 'dir_missing');
    assert.equal(new StartupError('migrations_unreadable').message, 'migrations_unreadable');
  });

  it('defaults to the configuration verdict for ConfigError and to 1 for StartupError', () => {
    assert.equal(new ConfigError().exitCode, EXIT_CONFIG);
    assert.equal(new ConfigError().reason, 'invalid_port');
    assert.equal(new StartupError().exitCode, EXIT_STARTUP);
    assert.equal(new StartupError().reason, 'unexpected');
  });
});
