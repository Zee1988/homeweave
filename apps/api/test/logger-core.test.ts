import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLoggerCore, NEST_TO_PINO, type LoggerCoreOptions } from '../src/logging/logger-core.ts';
import { sanitize } from '../src/logging/sanitize.ts';

// The core is a factory taking its writer and its redactor as arguments, which is the whole
// point of extracting it: these tests assert the record that reaches pino without a Nest
// container, a live server or a spy on stdout. `logger-core.ts` imports no `@nestjs/*`
// symbol and nothing relative, so `--experimental-strip-types` loads it directly.

type Payload = Record<string, unknown>;

interface RecordedCall {
  readonly level: string;
  readonly payload: Payload;
}

interface FakePino {
  instance: {
    level: string;
    trace(payload: Payload): void;
    debug(payload: Payload): void;
    info(payload: Payload): void;
    warn(payload: Payload): void;
    error(payload: Payload): void;
    fatal(payload: Payload): void;
  };
  calls: RecordedCall[];
  last: () => RecordedCall;
}

function fakePino(): FakePino {
  const calls: RecordedCall[] = [];
  const record =
    (level: string) =>
    (payload: Payload): void => {
      calls.push({ level, payload });
    };

  return {
    // Structurally identical to `PinoLike`; a real pino logger satisfies the same shape.
    instance: {
      level: 'info',
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      fatal: record('fatal'),
    },
    calls,
    last: () => calls[calls.length - 1],
  };
}

/** Production wiring, minus the async-context reader: the real `sanitize`, no requestId. */
function build(pino: FakePino, overrides: Partial<LoggerCoreOptions> = {}) {
  return createLoggerCore(pino.instance, { sanitize, ...overrides });
}

test('error(message, stack, context) maps the stack into err.stack, not into msg', () => {
  const pino = fakePino();
  build(pino).error(
    'cannot reach Supervisor',
    'Error: ECONNREFUSED\n    at connect (net.js:1:1)',
    'HealthController',
  );

  const call = pino.last();
  assert.equal(call.level, 'error');
  // A single-line record with the stack in its own field stays greppable; a multi-line
  // `msg` breaks one-record-per-line parsing in the Supervisor log.
  assert.deepEqual(call.payload, {
    msg: 'cannot reach Supervisor',
    context: 'HealthController',
    err: { stack: 'Error: ECONNREFUSED\n    at connect (net.js:1:1)' },
  });
  assert.ok(!String(call.payload.msg).includes('at connect'));
});

test('log(message, context) becomes { msg, context } with no err field', () => {
  const pino = fakePino();
  build(pino).log('routes mapped', 'InstanceLoader');

  assert.equal(pino.last().level, 'info');
  assert.deepEqual(pino.last().payload, { msg: 'routes mapped', context: 'InstanceLoader' });
});

test('a credential in the payload is masked before pino sees it', () => {
  const pino = fakePino();
  build(pino).log(
    {
      headers: { authorization: 'Bearer test-token-12345', accept: 'application/json' },
      url: 'http://supervisor/health?access_token=abc123',
    },
    'RequestLog',
  );

  const payload = pino.last().payload;
  const headers = payload.headers as Record<string, unknown>;

  assert.equal(headers.authorization, '[REDACTED]');
  // T-03-06's counterweight: redaction must stay surgical or the line stops being useful.
  assert.equal(headers.accept, 'application/json');
  assert.ok(!JSON.stringify(payload).includes('test-token-12345'), 'the raw token reached pino');
});

test('every field — msg included — passes through the redactor in one call', () => {
  const pino = fakePino();
  const seen: unknown[] = [];
  const core = createLoggerCore(pino.instance, {
    sanitize: (value) => {
      seen.push(value);
      return value;
    },
  });

  core.log('hello', 'Ctx');

  // One call over the composite record, not one per field: a per-field scheme is how a
  // payload nested deeper than the author looked gets through unmasked.
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { msg: 'hello', context: 'Ctx' });
});

test('a secret interpolated into the message itself is masked too', () => {
  const pino = fakePino();
  build(pino).warn('upstream rejected Bearer test-token-12345', 'Upstream');

  const payload = pino.last().payload;
  assert.equal(payload.msg, 'upstream rejected ***REDACTED***');
  assert.ok(!JSON.stringify(payload).includes('test-token-12345'));
});

test('the requestId from the injected context is carried on every line', () => {
  const pino = fakePino();
  build(pino, { getRequestId: () => '9f1c4d20-7a3b-4c8e-9d21-5b6a0e2f7c11' }).debug(
    'serving liveness probe',
    'HealthController',
  );

  assert.equal(pino.last().payload.requestId, '9f1c4d20-7a3b-4c8e-9d21-5b6a0e2f7c11');
});

test('outside a request context the record simply has no requestId field', () => {
  const pino = fakePino();
  build(pino).log('startup', 'Bootstrap');

  assert.equal('requestId' in pino.last().payload, false);
});

test('every Nest level reaches its pino method, verbose included', () => {
  const pino = fakePino();
  const core = build(pino);

  for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
    core[level]('x', 'Ctx');
  }

  assert.deepEqual(
    pino.calls.map((call) => call.level),
    ['info', 'error', 'warn', 'debug', 'trace', 'fatal'],
  );
  assert.equal(NEST_TO_PINO.verbose, 'trace', 'verbose must not be dropped or folded into debug');
});

test('setLogLevels resolves a Nest set to the most verbose pino level', () => {
  const pino = fakePino();
  const core = build(pino);

  core.setLogLevels(['error', 'warn']);
  assert.equal(pino.instance.level, 'warn', 'info must be silenced when only warn and error are on');

  core.setLogLevels(['error', 'debug']);
  assert.equal(pino.instance.level, 'debug');

  core.setLogLevels([]);
  assert.equal(pino.instance.level, 'silent');
});
