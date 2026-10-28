// Recursive redaction for log payloads (D-03, threat T-03-05).
//
// Why this is hand-written rather than pino's `redact` (03-RESEARCH.md §5.2):
//   - `redact` takes static paths only. A blacklist that must hit `authorization` at *any*
//     depth cannot be expressed, and `**` does not exist in the documented grammar.
//   - It cannot match value patterns (`Bearer …`, `sk-…`), which is the only defence left
//     once a secret arrives under a key name nobody predicted.
//   - It has no cycle protection: `JSON.stringify` throws on a self-referencing object, and
//     a throwing logger inside an error handler loses the error it was called to report.
// `redact` is therefore not used at all. One mechanism, one place to review.
//
// This module is deliberately pure — no Nest import, no pino import, no I/O — so the unit
// test runs straight off the TypeScript source under `node --experimental-strip-types`.

/** What a value under a blacklisted key name becomes. Never a truncated secret. */
export const REDACTED = '[REDACTED]';

/** Fragment substituted where a value *pattern* matched inside an otherwise useful string. */
export const VALUE_MASK = '***REDACTED***';

/** Marks a back-reference to an ancestor, so the log line stays valid JSON. */
export const CIRCULAR = '[Circular]';

/** Marks a container below the depth budget. See `MAX_DEPTH`. */
export const MAX_DEPTH_MARKER = '[MaxDepth]';

/** A property whose getter threw. Logging must not be the thing that crashes the process. */
export const UNREADABLE = '[Unreadable]';

/**
 * Container levels kept before truncation, counting the root as 0.
 *
 * A budget is necessary (a 10k-deep chain overflows the stack), and 6 is chosen to sit
 * just above the deepest payload this app actually builds: `err.config.headers.*` is
 * depth 4, a Prisma error's `meta` inside `data` is depth 3. Beyond that the shape is
 * hand-built and a `[MaxDepth]` marker is more useful than a truncated blob.
 */
export const MAX_DEPTH = 6;

/**
 * Key names whose *value* is replaced wholesale, compared lower-cased.
 *
 * Both spellings of the API-key family appear on purpose: `x-api-key` and `apiKey` come
 * from HTTP conventions, `api_key` from provider SDKs' request bodies. The list is a
 * denylist, not an allowlist — an allowlist breaks the first time a provider adds a field.
 */
export const REDACTED_KEYS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'apikey',
  'api_key',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'ha_token',
  'supervisor_token',
];

const BLACKLIST = new Set(REDACTED_KEYS);

/**
 * Credential shapes recognised *inside* string values, so a secret under an unforeseen key
 * still gets masked. Sources are exported one by one for the test to name its failures;
 * the regex objects are built per call because a shared `/g` regex would carry `lastIndex`
 * between calls and silently mask every other match.
 */
export interface ValuePattern {
  readonly name: string;
  readonly source: string;
  readonly flags: string;
}

export const VALUE_PATTERNS: readonly ValuePattern[] = [
  // `Authorization` / `Proxy-Authorization` schemes.
  { name: 'bearer', source: '\\bBearer\\s+[A-Za-z0-9._~+/=-]{8,}', flags: 'i' },
  { name: 'token', source: '\\bToken\\s+[A-Za-z0-9._~+/=-]{8,}', flags: 'i' },
  { name: 'basic', source: '\\bBasic\\s+[A-Za-z0-9+/=]{8,}', flags: 'i' },
  // Provider key formats that are recognisable without their key name.
  { name: 'openai-sk', source: '\\bsk-[A-Za-z0-9]{16,}', flags: '' },
  { name: 'github-pat', source: '\\bghp_[A-Za-z0-9]{20,}', flags: '' },
  // JWT: the first two base64url segments are always long enough to be unambiguous.
  {
    name: 'jwt',
    source: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.',
    flags: '',
  },
];

/**
 * Returns a redacted **copy** of `value`.
 *
 * Contract:
 *   - the argument is never mutated, and no returned object shares identity with an input
 *     container, so a caller can keep logging the original;
 *   - it never throws for any input, including cyclic structures and throwing getters;
 *   - the result is always JSON-serialisable (no cycles, no unexpanded functions, no
 *     `bigint`, which `JSON.stringify` rejects outright).
 */
export function sanitize(value: unknown): unknown {
  return walk(value, 0, new WeakSet<object>());
}

function walk(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') return maskString(value);
  // `bigint` is the one primitive that is *not* JSON-serialisable (the other three
  // non-numeric primitives are dropped by `JSON.stringify` rather than throwing). A
  // Prisma error carrying an `Int8`/`BigInt` id in `meta` would therefore make the
  // pino write itself fail — inside the error handler that called it. The `n` suffix
  // keeps the value readable and unmistakably not a plain number.
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value !== 'object' || value === null) return value;

  // Budget check before the cycle check: a cyclic chain also has infinite depth, and
  // reporting `[MaxDepth]` is the more honest diagnosis of the two.
  if (depth > MAX_DEPTH) return MAX_DEPTH_MARKER;

  // Leaves that carry their own structure are copied/described rather than walked.
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;

  if (ancestors.has(value)) return CIRCULAR;

  // Add on enter, delete on exit: an object *shared* by two siblings is expanded twice
  // (still no cycle), while a true back-reference to an ancestor is caught. A plain
  // never-removed set would mislabel every shared reference as `[Circular]`.
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, ancestors));
    if (value instanceof Map) {
      return [...value.entries()].map(([key, entry]) => [
        walk(key, depth + 1, ancestors),
        // A Map key is a key name like any object property, so the blacklist applies to it
        // as well — `new Map([['authorization', 'Bearer …']])` must not leak.
        typeof key === 'string' && BLACKLIST.has(key.toLowerCase())
          ? REDACTED
          : walk(entry, depth + 1, ancestors),
      ]);
    }
    if (value instanceof Set) {
      return [...value.values()].map((entry) => walk(entry, depth + 1, ancestors));
    }
    if (value instanceof Error) return walkError(value, depth, ancestors);
    return walkRecord(value as Record<string, unknown>, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function walkRecord(
  record: Record<string, unknown>,
  depth: number,
  ancestors: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  // Own enumerable string keys only. Prototype getters are not copied because a class
  // instance logged by accident should show its fields, not execute its methods.
  for (const key of Object.keys(record)) {
    let raw: unknown;
    try {
      raw = record[key];
    } catch {
      raw = UNREADABLE;
    }
    setOwn(output, key, BLACKLIST.has(key.toLowerCase()) ? REDACTED : walk(raw, depth + 1, ancestors));
  }

  return output;
}

function walkError(
  error: Error,
  depth: number,
  ancestors: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: error.name,
    // The message is masked, not passed through: provider SDKs routinely interpolate the
    // failing request (`... 401 for https://host/path?token=…`) into it. The stack keeps
    // its line structure, but its header line repeats the message, so it is masked too.
    message: maskString(error.message),
    stack: typeof error.stack === 'string' ? maskString(error.stack) : undefined,
  };

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) output.cause = walk(cause, depth + 1, ancestors);

  return output;
}

/**
 * Replaces every match of every value pattern. Over-masking is accepted here: a log line
 * that says `***REDACTED*** 12345678` is a cosmetic loss, while the alternative is a
 * credential in the Supervisor log (T-03-05).
 */
function maskString(input: string): string {
  let output = input;
  for (const pattern of VALUE_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, `${pattern.flags}g`), VALUE_MASK);
  }
  return output;
}

/**
 * Defines an enumerable own property instead of assigning it.
 *
 * `output[key] = …` with `key === '__proto__'` would replace the prototype, so a payload
 * crafted as `{ "__proto__": { "isAdmin": true } }` would poison every later read of the
 * redacted object — a log payload must not be able to do that.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
