// Generate HomeWeave App metadata artifacts from a single source of truth.
//
// Source: homeweave_app/app-metadata.json
// Output: repository.yaml (repository root) and homeweave_app/config.yaml
//
// Implementation note (deliberate design decision, see 01-PATTERNS.md section 2):
// this script builds the YAML line by line as strings instead of serialising an
// object through `js-yaml`. That serialiser cannot emit comments, so letting it
// write the file would silently delete the intentionally commented-out `ports`
// block that D-07 requires to survive in the generated file. String composition also makes the
// key order in config.yaml 100% deterministic, which is what keeps regenerating
// the artifacts a zero-diff operation (D-02).
//
// Other hard requirements baked in here:
// - no shebang (win32; invoked only through the pnpm script `generate:app`)
// - every written string uses explicit "\n" line endings, never the platform EOL
// - exactly one trailing newline, no "---" document marker, 2-space indentation
// - lists are written as "key:" followed by "  - item", never flow style
// - no timestamps, commit hashes, or random values: same input -> identical bytes

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_PATH = join(REPO_ROOT, 'homeweave_app', 'app-metadata.json');
const REPOSITORY_YAML_PATH = join(REPO_ROOT, 'repository.yaml');
const CONFIG_YAML_PATH = join(REPO_ROOT, 'homeweave_app', 'config.yaml');

// The documentation reference kept at the top of the generated config.yaml.
// Source: Home Assistant Apps configuration reference (contributors.home-assistant.io).
const CONFIG_REFERENCE_COMMENT =
  '# Reference: https://contributors.home-assistant.io/apps/reference/configuration/';

// Why the commented-out `ports` block is kept in the artifact at all.
const PORTS_DEFERRAL_NOTE =
  "# ports stays closed until Phase 5 delivers HomeWeave's own authentication and authorization.";

const LINE_END = '\n';

// `--check` turns this script into a read-only drift guard (see package.json `check:app`).
// It builds the artifacts in memory exactly as a real run would, compares them byte for
// byte against what is on disk, and never writes. The point is that "the source changed and
// nobody regenerated" stops being a silent, all-green state: the artifacts are what
// Supervisor reads, so a stale one ships a stale version to Phase 2's image tag.
const CHECK_ONLY = process.argv.includes('--check');

// Populated only in CHECK_ONLY runs, printed as one collected summary at the end (the same
// collect-then-report style the validator uses; fail-fast would hide the second stale file).
const outOfDate = [];

function fail(path, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed: ${path}: ${message}`);
  process.exit(1);
}

/** Repo-relative path with forward slashes, so win32 backslashes never leak into messages. */
function relativeToRepo(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}

/** Truncate a line for the drift message: full diffs are noise and pollute test assertions. */
function describeLine(value) {
  if (value === undefined) return '<end of file>';
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * Fold the line endings a checkout may have imposed back to the only form this generator
 * ever writes.
 *
 * This is not laxity, it is the environment: this repository has `core.autocrlf=true` and no
 * `.gitattributes`, so a fresh Windows clone checks the artifacts out as CRLF while the
 * generator always writes LF. Without this fold, `--check` reports "Out of date" on every
 * clean clone and on nothing that is actually stale -- a guard that is red before anyone has
 * done anything wrong, which is the same as no guard (people disable it). Verified by cloning
 * the repository into a temp directory and running `--check` there.
 *
 * Only EOL is folded. Any other difference still trips the guard, including a lone CR.
 */
function normaliseLineEndings(text) {
  return text.replace(/\r\n/g, LINE_END);
}

/**
 * Describe where the on-disk content first diverges from the freshly built content.
 * Only the first differing line is reported -- enough to locate the drift, not so much
 * that the message becomes an unreadable diff.
 */
function describeDrift(expected, actual) {
  if (actual === null) return 'artifact is missing';
  const expectedLines = expected.split(LINE_END);
  const actualLines = actual.split(LINE_END);
  const lineCount = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < lineCount; index += 1) {
    if (expectedLines[index] === actualLines[index]) continue;
    return `first difference at line ${index + 1}: expected ${describeLine(expectedLines[index])}, found ${describeLine(actualLines[index])}`;
  }
  return 'content differs only in bytes after the last newline';
}

function readSource() {
  try {
    return JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  } catch (error) {
    fail(SOURCE_PATH, error);
  }
}

// Plain-scalar allowlist: anything outside it is emitted double-quoted.
//
// This used to be a denylist ("quote if the value looks risky"), which fails silently: YAML
// has a whole set of indicators that are only special as the FIRST character of a plain
// scalar -- & (anchor), * (alias), @ (reserved), [ ] { } (flow), : (mapping), # (comment),
// % (directive). Each indicator the denylist forgets silently changes the value:
// `&anchor AI OS` was emitted bare and parsed back as `AI OS`, with exit 0 and valid YAML.
//
// An allowlist inverts the failure direction: an unrecognised character only earns the value
// a pair of quotes, which is harmless because quote style is never load-bearing. Parsers
// assert parsed values, never quote style.
//
// The `value.trim() === value` clause is NOT made redundant by the space in the character
// class. YAML strips trailing whitespace from a plain scalar while parsing, so emitting
// `AI OS ` bare would read back as `AI OS` -- exit 0, valid YAML, value changed. That is the
// same failure class as the anchor bug, so leading/trailing whitespace must force quoting.
const PLAIN_SCALAR = /^[A-Za-z][A-Za-z0-9 _./@()+-]*$/;

function scalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') {
    throw new Error(`unsupported scalar type: ${typeof value}`);
  }
  if (value.trim() === value && PLAIN_SCALAR.test(value)) return value;
  return JSON.stringify(value);
}

function listBlock(key, values) {
  return [`${key}:`, ...values.map((item) => `  - ${scalar(item)}`)];
}

// ---------------------------------------------------------------------------------------
// Input assertions. Every one of these throws (main turns the throw into `Failed: <path>: …`)
// because the only two alternatives are worse: read a key that is not there and emit
// `undefined` into an artifact, or throw a raw TypeError with a stack trace that names an
// internal function instead of the source key the author actually mistyped.
// ---------------------------------------------------------------------------------------

/** Assert a source section is a plain object, so Object.keys / property reads are safe. */
function assertObject(keyPath, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${keyPath} must be an object; got ${Array.isArray(value) ? 'array' : String(value === null ? 'null' : typeof value)}`);
  }
}

/**
 * Assert `value` is a non-empty array of strings.
 *
 * This is not defensive noise: iterating a string with `for...of` yields its characters, so a
 * `commentedPortsBlock` accidentally written as a single string would emit a comment block
 * made of one-character lines -- exit 0, valid YAML, content destroyed.
 */
function assertStringList(keyPath, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${keyPath} must be a non-empty array of strings`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || item === '') {
      throw new Error(`${keyPath} entries must be non-empty strings; got ${JSON.stringify(item)}`);
    }
  }
}

/**
 * Assert `value` is a string with something in it.
 *
 * This exists because `scalar()` is deliberately permissive: a number or a boolean is emitted
 * verbatim, so `repository.maintainer: 42` produces `maintainer: 42` -- valid YAML, exit 0,
 * and an artifact that only fails on the Supervisor side, where the whole repository then
 * fails to load and no app appears at all. Same discipline as assertObject / assertStringList:
 * stop on the source, before anything is written.
 *
 * The label is computed explicitly instead of using `typeof value` directly because typeof is
 * misleading for three inputs: `typeof null === 'object'` (so `maintainer: null` would report
 * `got object`), an array reports `object`, and `undefined` reports `undefined` in a message
 * that then reads like a typo in the message rather than a missing key.
 */
function assertNonEmptyString(keyPath, value) {
  if (typeof value === 'string' && value.trim() !== '') return;
  const label = value === null ? 'null' : Array.isArray(value) ? 'array' : value === undefined ? 'undefined' : typeof value;
  throw new Error(`${keyPath} must be a non-empty string; got ${label}`);
}

function buildRepositoryYaml(repository) {
  assertObject('repository', repository);
  // Value guards run BEFORE scalar(): scalar() stringifies 42 / true without complaint, so an
  // assertion placed after it would be looking at an already-plausible string. repository.yaml
  // is the whole-repository manifest -- one bad value here makes Supervisor reject the entire
  // repository, not just this app.
  assertNonEmptyString('repository.name', repository.name);
  assertNonEmptyString('repository.url', repository.url);
  assertNonEmptyString('repository.maintainer', repository.maintainer);
  // Key order is part of the contract: name -> url -> maintainer.
  return [`name: ${scalar(repository.name)}`, `url: ${scalar(repository.url)}`, `maintainer: ${scalar(repository.maintainer)}`];
}

// schema DSL strings are derived from the semantic option definitions so the DSL
// text exists only in the generated artifact, never duplicated in the source.
function buildSchemaDsl(optionDefs) {
  // Reading the keys off a possibly-undefined object is what used to produce
  // `TypeError: Cannot read properties of undefined (reading 'type')`. Guards first.
  assertObject('app.optionDefs', optionDefs);

  const logLevel = optionDefs.logLevel;
  assertObject('app.optionDefs.logLevel', logLevel);
  if (logLevel.type !== 'enum') {
    throw new Error(`app.optionDefs.logLevel.type must be "enum", got ${JSON.stringify(logLevel.type)}`);
  }
  assertStringList('app.optionDefs.logLevel.values', logLevel.values);

  const haUrl = optionDefs.haUrl;
  assertObject('app.optionDefs.haUrl', haUrl);
  if (haUrl.type !== 'string') {
    throw new Error(`app.optionDefs.haUrl.type must be "string", got ${JSON.stringify(haUrl.type)}`);
  }

  // Enum -> list(a|b|c); optional string -> str? (quoted as a whole, see scalar()).
  return {
    log_level: `list(${logLevel.values.join('|')})`,
    ha_url: haUrl.optional === true ? 'str?' : 'str',
  };
}

function buildConfigYaml(app) {
  assertObject('app', app);
  // listBlock() maps over whatever it is given, so a non-array arch would either throw a raw
  // TypeError or (worse, for a string) silently become a per-character list.
  assertStringList('app.arch', app.arch);
  assertObject('app.options', app.options);
  assertStringList('app.commentedPortsComment', app.commentedPortsComment);
  assertStringList('app.commentedPortsBlock', app.commentedPortsBlock);

  // Key order is part of the contract (01-PATTERNS.md section 4). Any reordering
  // is a defect: it would produce a meaningless diff on every regeneration.
  const lines = [
    CONFIG_REFERENCE_COMMENT,
    `name: ${scalar(app.name)}`,
    `slug: ${scalar(app.slug)}`,
    `version: ${scalar(app.version)}`,
    `description: ${scalar(app.description)}`,
    `url: ${scalar(app.url)}`,
    ...listBlock('arch', app.arch),
    `init: ${scalar(app.init)}`,
    `image: ${scalar(app.image)}`,
    `homeassistant: ${scalar(app.homeassistant)}`,
    `homeassistant_api: ${scalar(app.homeassistant_api)}`,
    `ingress: ${scalar(app.ingress)}`,
    `ingress_port: ${scalar(app.ingress_port)}`,
  ];

  lines.push('options:');
  for (const [key, value] of Object.entries(app.options)) {
    lines.push(`  ${key}: ${scalar(value)}`);
  }

  const schema = buildSchemaDsl(app.optionDefs);
  lines.push('schema:');
  for (const [key, value] of Object.entries(schema)) {
    lines.push(`  ${key}: ${scalar(value)}`);
  }

  // Commented tail block: the `ports` declaration must survive as a comment.
  lines.push('');
  lines.push(PORTS_DEFERRAL_NOTE);
  for (const comment of app.commentedPortsComment) {
    lines.push(`# ${comment}`);
  }
  for (const blockLine of app.commentedPortsBlock) {
    lines.push(`# ${blockLine}`);
  }

  return lines;
}

// Dual-mode writer. In normal mode it is the only place artifacts are written; in CHECK_ONLY
// mode it is the only place drift is *detected*, and it is deliberately incapable of writing
// (no mkdirSync, no writeFileSync on that branch) so `--check` cannot "fix" what it found.
function writeLines(path, lines) {
  const next = lines.join(LINE_END) + LINE_END;

  if (CHECK_ONLY) {
    let current = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      // A missing artifact is drift, not a pass: it is exactly the state a fresh clone that
      // never ran the generator is in, and Supervisor would find no app at all.
      current = null;
    }
    // Compare content, not checkout policy: see normaliseLineEndings().
    const currentNormalised = current === null ? null : normaliseLineEndings(current);
    if (currentNormalised !== next) {
      outOfDate.push(`Out of date: ${relativeToRepo(path)} (run \`corepack pnpm generate:app\`) - ${describeDrift(next, currentNormalised)}`);
    }
    return;
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, 'utf8');
  } catch (error) {
    fail(path, error);
  }
}

/**
 * Every `app` key the generator actually consumes.
 *
 * This list exists to make the generator fail closed on its own input. Before it, a key the
 * builder never read -- a typo, a rename, an idea someone added and forgot to wire up -- was
 * silently dropped: `app.watchdog = true` produced exit 0 and an artifact with no watchdog in
 * it. That breaks the one invariant the whole single-source-of-truth design rests on, namely
 * that "the generator ran clean" means "the source was applied". Keep this list in sync with
 * buildConfigYaml / buildSchemaDsl; the failure message says so.
 */
const APP_SOURCE_KEYS = [
  'name',
  'slug',
  'version',
  'description',
  'url',
  'arch',
  'init',
  'image',
  'homeassistant',
  'homeassistant_api',
  'ingress',
  'ingress_port',
  'options',
  'optionDefs',
  'commentedPortsComment',
  'commentedPortsBlock',
];

/** Every `repository` key the generator consumes (same rationale as APP_SOURCE_KEYS). */
const REPOSITORY_SOURCE_KEYS = ['name', 'url', 'maintainer'];

/**
 * Assert a source section holds exactly the keys the generator consumes.
 *
 * Both directions matter. An unknown key means the author believes something is being
 * published that is not. A missing key means the builder would read `undefined` and write it
 * into an artifact -- or crash later with a TypeError that points at internals, not at the
 * source. Either way the run must stop before anything is written.
 */
function assertConsumedKeys(section, value, consumed) {
  assertObject(section, value);

  for (const key of Object.keys(value)) {
    if (!consumed.includes(key)) {
      fail(SOURCE_PATH, new Error(`${section}.${key} is not consumed by the generator (add it to buildConfigYaml or delete it)`));
    }
  }
  for (const key of consumed) {
    if (!Object.hasOwn(value, key)) {
      fail(SOURCE_PATH, new Error(`${section}.${key} is missing (the generator reads it)`));
    }
  }
}

function main() {
  const metadata = readSource();

  const topLevelKeys = Object.keys(metadata);
  const expectedKeys = ['repository', 'app'];
  if (topLevelKeys.join('|') !== expectedKeys.join('|')) {
    fail(SOURCE_PATH, new Error(`top-level keys must be exactly ${expectedKeys.join(', ')}; got ${topLevelKeys.join(', ')}`));
  }

  // Full source validation first, artifact construction second, disk writes last.
  //
  // Build-then-write is the minimal mitigation for the non-atomic two-file write: if anything
  // below throws, neither artifact has been touched yet. (A full two-phase temp-file + rename
  // commit is deliberately out of scope -- see the plan's deferred items.)
  assertConsumedKeys('repository', metadata.repository, REPOSITORY_SOURCE_KEYS);
  assertConsumedKeys('app', metadata.app, APP_SOURCE_KEYS);

  const missingImage = typeof metadata.app.image === 'string' && metadata.app.image !== metadata.app.image.toLowerCase();
  if (missingImage) {
    fail(SOURCE_PATH, new Error('app.image must be lowercase (container registries reject uppercase paths)'));
  }
  if (typeof metadata.app.image === 'string' && metadata.app.image.includes(':')) {
    fail(SOURCE_PATH, new Error('app.image must not carry a tag'));
  }

  let repositoryLines;
  let configLines;
  try {
    repositoryLines = buildRepositoryYaml(metadata.repository);
    configLines = buildConfigYaml(metadata.app);
  } catch (error) {
    // Fail closed with the generator's normal `Failed: <source>: <msg>` shape, never a raw
    // stack trace: the message has to name the source key the author mistyped.
    fail(SOURCE_PATH, error);
  }

  writeLines(REPOSITORY_YAML_PATH, repositoryLines);
  writeLines(CONFIG_YAML_PATH, configLines);

  // Collect-then-report: every stale artifact is named before the process exits non-zero.
  if (CHECK_ONLY && outOfDate.length > 0) {
    for (const message of outOfDate) console.error(message);
    console.error(`${outOfDate.length} artifact(s) out of date`);
    process.exitCode = 1;
  }
}

main();
