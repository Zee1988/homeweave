import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CIRCULAR,
  MAX_DEPTH,
  MAX_DEPTH_MARKER,
  REDACTED,
  REDACTED_KEYS,
  UNREADABLE,
  VALUE_MASK,
  VALUE_PATTERNS,
  sanitize,
} from '../src/logging/sanitize.ts';

// The point of these tests is threat T-03-05 (a credential reaching stdout) and its
// mirror image, T-03-06 (redaction so aggressive the log stops being useful). Every case
// below therefore asserts *both* the masked value and, where one exists, the neighbouring
// value that must survive.

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value as Json;
}

/** `depth` containers wrapping `leaf`, outermost first. */
function nest(depth: number, leaf: unknown): unknown {
  let node: unknown = leaf;
  for (let level = 0; level < depth; level += 1) node = { child: node };
  return node;
}

/** `hops` `.child` dereferences, for asserting exactly where truncation starts. */
function descend(value: unknown, hops: number): unknown {
  let node = value;
  for (let hop = 0; hop < hops; hop += 1) node = asRecord(node).child;
  return node;
}

test('every blacklisted key name is masked at the top level', () => {
  // The plan asks for the eleven keys that actually travel through this app; the list is
  // longer because provider SDKs add spellings. Asserting the exported list keeps the test
  // honest if someone adds a key without adding a case.
  assert.ok(REDACTED_KEYS.length >= 11, `expected at least 11 keys, got ${REDACTED_KEYS.length}`);

  for (const key of REDACTED_KEYS) {
    const output = asRecord(sanitize({ [key]: 'super-secret-value' }));
    assert.equal(output[key], REDACTED, `${key} was not masked`);
  }
});

test('key matching is case-insensitive and applies at every depth and inside arrays', () => {
  const output = asRecord(
    sanitize({
      Headers: { AUTHORIZATION: 'Bearer abcdefgh123456' },
      nested: { deeper: { ha_token: 'ha-live-token' } },
      list: [{ cookie: 'session=abc123' }, { ok: true }],
    }),
  );

  assert.equal(asRecord(output.Headers).AUTHORIZATION, REDACTED);
  assert.equal(asRecord(asRecord(asRecord(output.nested).deeper)).ha_token, REDACTED);
  assert.equal(asRecord((output.list as unknown[])[0]).cookie, REDACTED);
  assert.equal(asRecord((output.list as unknown[])[1]).ok, true);
});

test('all six value patterns are masked wherever they appear', () => {
  const secrets: Record<string, string> = {
    bearer: 'Bearer test-token-12345',
    token: 'Token abcdefgh1234',
    basic: 'Basic dXNlcjpwYXNz',
    'openai-sk': 'sk-abcdefghijklmnopqrstuvwx',
    'github-pat': 'ghp_abcdefghijklmnopqrstuvwxyz0123',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl',
  };

  assert.deepEqual(
    VALUE_PATTERNS.map((pattern) => pattern.name),
    Object.keys(secrets),
    'the pattern list and this test have drifted apart',
  );

  for (const [name, secret] of Object.entries(secrets)) {
    // Under an innocent key name: the key blacklist cannot help here, only the pattern.
    const output = asRecord(sanitize({ note: `upstream said: ${secret} (retrying)` }));
    assert.ok(String(output.note).includes(VALUE_MASK), `${name} was not masked`);
    assert.ok(!String(output.note).includes(secret.split(' ')[1] ?? secret), `${name} leaked`);
  }

  // The JWT case additionally proves the payload segment is gone, not just the prefix.
  const jwt = asRecord(sanitize({ note: secrets.jwt }));
  assert.ok(!String(jwt.note).includes('eyJzdWIiOiIxMjM0NTY3ODkwIn0'));
});

test('redaction is surgical: neighbouring non-sensitive headers survive', () => {
  const output = asRecord(
    sanitize({
      headers: {
        authorization: 'Bearer test-token-12345',
        cookie: 'session=abc123',
        accept: 'application/json',
        'user-agent': 'homeweave-test/1.0',
        'content-type': 'application/json',
      },
    }),
  );
  const headers = asRecord(output.headers);

  assert.equal(headers.authorization, REDACTED);
  assert.equal(headers.cookie, REDACTED);
  // T-03-06: replacing the whole `headers` object would pass the checks above and make the
  // log useless for debugging. These three assertions are the counterweight.
  assert.equal(headers.accept, 'application/json');
  assert.equal(headers['user-agent'], 'homeweave-test/1.0');
  assert.equal(headers['content-type'], 'application/json');
});

test('a self-referencing object yields [Circular] instead of throwing', () => {
  const cyclic: Json = { name: 'root' };
  cyclic.self = cyclic;

  let output: Json | undefined;
  assert.doesNotThrow(() => {
    output = asRecord(sanitize(cyclic));
  });

  assert.ok(output !== undefined);
  assert.equal(output.self, CIRCULAR);
  assert.equal(output.name, 'root');
  // A valid JSON line is the actual requirement: the Supervisor parses one record per line.
  assert.doesNotThrow(() => JSON.stringify(output));
});

test('a shared (non-cyclic) child is expanded twice, not mislabelled as circular', () => {
  const shared = { id: 7 };
  const output = asRecord(sanitize({ left: shared, right: shared }));

  assert.deepEqual(output.left, { id: 7 });
  assert.deepEqual(output.right, { id: 7 });
  assert.notEqual(output.left, CIRCULAR);
});

test('nesting up to MAX_DEPTH survives and deeper levels are truncated', () => {
  const kept = sanitize(nest(MAX_DEPTH, 'leaf'));
  assert.equal(descend(kept, MAX_DEPTH), 'leaf');

  // Containers live at depths 0..MAX_DEPTH, so the first one past the budget sits at
  // depth MAX_DEPTH + 1 and is exactly what `[MaxDepth]` replaces.
  const truncated = sanitize(nest(MAX_DEPTH + 2, 'leaf'));
  assert.equal(descend(truncated, MAX_DEPTH + 1), MAX_DEPTH_MARKER);

  // And an unbounded chain must terminate rather than overflow the stack.
  assert.doesNotThrow(() => sanitize(nest(200, 'leaf')));
});

test('the input object is not mutated and nothing is shared with the output', () => {
  const input = {
    headers: { authorization: 'Bearer abcdefgh123456', accept: 'application/json' },
    list: [{ token: 'abc' }],
  };
  const before = JSON.stringify(input);

  const output = asRecord(sanitize(input));

  assert.equal(JSON.stringify(input), before, 'sanitize mutated its argument');
  assert.notEqual(output, input);
  assert.notEqual(output.headers, input.headers);
  assert.notEqual(output.list, input.list);
  assert.equal(input.headers.authorization, 'Bearer abcdefgh123456');
});

test('arrays keep their order and non-plain containers are converted predictably', () => {
  const map = new Map<string, unknown>([
    ['access_token', 'tok-123'],
    ['safe', 'value'],
  ]);
  const set = new Set<unknown>(['a', 'Bearer abcdefgh1234']);

  const output = asRecord(
    sanitize({
      list: [3, 1, 2],
      map,
      set,
      date: new Date('2026-10-28T00:00:00.000Z'),
      pattern: /secret/gi,
      buffer: Buffer.from('super-secret-bytes'),
    }),
  );

  assert.deepEqual(output.list, [3, 1, 2]);
  assert.deepEqual(output.map, [
    ['access_token', REDACTED],
    ['safe', 'value'],
  ]);
  assert.deepEqual(output.set, ['a', VALUE_MASK]);
  assert.ok(output.date instanceof Date);
  assert.equal((output.date as Date).toISOString(), '2026-10-28T00:00:00.000Z');
  assert.ok(output.pattern instanceof RegExp);
  assert.equal(output.buffer, `<Buffer ${Buffer.from('super-secret-bytes').length} bytes>`);
});

test('errors are expanded into fields and their message is masked', () => {
  const cause = new Error('inner failure');
  const error = new Error('request failed with Bearer abcdefgh123456', { cause });

  const output = asRecord(sanitize({ err: error }));
  const err = asRecord(output.err);

  assert.equal(err.name, 'Error');
  assert.match(String(err.message), /request failed with \*\*\*REDACTED\*\*\*/);
  assert.ok(!String(err.message).includes('abcdefgh123456'));
  assert.match(String(err.stack), /^Error: /);
  assert.doesNotThrow(() => JSON.stringify(err), 'error output must stay serialisable');
  assert.equal(asRecord(err.cause).message, 'inner failure');
});

test('a throwing getter becomes [Unreadable] instead of crashing the logger', () => {
  const hostile = {
    get boom(): string {
      throw new Error('getter exploded');
    },
    safe: 'kept',
  };

  const output = asRecord(sanitize(hostile));

  assert.equal(output.boom, UNREADABLE);
  assert.equal(output.safe, 'kept');
});

test('a __proto__ key cannot poison the prototype of the redacted object', () => {
  const hostile = JSON.parse('{"__proto__":{"isAdmin":true},"ok":"yes"}');

  const output = asRecord(sanitize(hostile));

  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal((output as { isAdmin?: boolean }).isAdmin, undefined);
  assert.equal(asRecord({}).isAdmin, undefined, 'the global Object prototype was polluted');
  assert.equal(output.ok, 'yes');
});

test('a bigint value becomes a labelled string instead of breaking JSON.stringify', () => {
  // `JSON.stringify` throws on a bare bigint, and pino serialises with it — so a Prisma
  // error carrying an Int8 id would fail to log. The audit added this branch; the test
  // pins both the shape and the "the line still serialises" requirement.
  const output = asRecord(sanitize({ id: 9007199254740993n }));

  assert.equal(output.id, '9007199254740993n');
  assert.doesNotThrow(() => JSON.stringify(output), 'a bigint payload must stay serialisable');
});
