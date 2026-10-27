/**
 * Proof suite for scripts/generate-app-metadata.mjs.
 *
 * What this proves: the generator notices when the source of truth
 * (homeweave_app/app-metadata.json) and the generated artifacts
 * (repository.yaml, homeweave_app/config.yaml) have drifted apart -- whether the source was
 * edited without regenerating, or an artifact was hand-edited. After this suite, "the source
 * changed and nobody regenerated" can no longer be an all-green state: `test:app` chains the
 * `--check` gate ahead of node:test, so a stale artifact makes the whole suite fail.
 *
 * What this does NOT prove: that Supervisor accepts the artifacts. Whether vol.Schema accepts
 * this repository, whether the add-on store renders an installable entry, whether the image
 * pulls and upgrades and whether ingress behaves -- all of that is HAOS runtime behaviour and
 * stays unverified in this phase (Phase 7 owns the on-device evidence). A green run here is
 * static-layer only.
 *
 * How the negative cases avoid touching the real repository: the generator derives its paths
 * from `import.meta.url`, never from process.cwd(). So each mutation case copies the real
 * generator bytes into a throwaway tree under os.tmpdir(), edits only that tree's source JSON
 * or artifacts, and spawns the copy. The real repository is never mutated by a passing run.
 * Fixtures must never live inside the repo tree for a second reason (validator V15): a stray
 * config.yaml in the repo would be discovered as a second app.
 *
 * Discipline: no assertion looks at YAML quote style. Quote style is never load-bearing --
 * only parsed values and exit codes are asserted.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { load as parseYaml } from 'js-yaml';

/** The generator under test (same file `pnpm generate:app` runs). */
const GENERATOR_PATH = fileURLToPath(new URL('../generate-app-metadata.mjs', import.meta.url));

/** Repository root, derived from this module's location -- never from process.cwd(). */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const REAL_SOURCE = join(REPO_ROOT, 'homeweave_app', 'app-metadata.json');
const REAL_REPOSITORY_YAML = join(REPO_ROOT, 'repository.yaml');
const REAL_CONFIG_YAML = join(REPO_ROOT, 'homeweave_app', 'config.yaml');

/** Repo-relative paths used in assertions, always with forward slashes. */
const REPOSITORY_YAML_REL = 'repository.yaml';
const CONFIG_YAML_REL = 'homeweave_app/config.yaml';

/**
 * Build a throwaway mirror of the repository's generator inputs.
 *
 * Copies the real generator (so its REPO_ROOT resolves to the temp tree), the real source
 * JSON and both real artifacts. `mutateSource` may edit the parsed source; when it is omitted
 * the source file is copied byte for byte, which is what the "hand-edited artifact" case
 * needs (that case must change exactly one thing: the artifact).
 */
function makeTempTree(t, mutateSource) {
  const root = mkdtempSync(join(tmpdir(), 'hw-gen-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'homeweave_app'), { recursive: true });

  copyFileSync(GENERATOR_PATH, join(root, 'scripts', 'generate-app-metadata.mjs'));

  const sourcePath = join(root, 'homeweave_app', 'app-metadata.json');
  if (mutateSource) {
    const source = JSON.parse(readFileSync(REAL_SOURCE, 'utf8'));
    mutateSource(source);
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  } else {
    copyFileSync(REAL_SOURCE, sourcePath);
  }

  copyFileSync(REAL_REPOSITORY_YAML, join(root, 'repository.yaml'));
  copyFileSync(REAL_CONFIG_YAML, join(root, 'homeweave_app', 'config.yaml'));

  return root;
}

/** Run the copy of the generator that lives in `root`. argv array form, never a shell string. */
function runGenerator(root, extraArgs = []) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'generate-app-metadata.mjs'), ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
  });
}

/** Combined output: the drift message may legitimately go to either stream. */
function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Snapshot both artifacts' hashes, to prove a run did (or did not) write. */
function artifactHashes(root) {
  return {
    repository: sha256(join(root, REPOSITORY_YAML_REL)),
    config: sha256(join(root, CONFIG_YAML_REL)),
  };
}

// ---------------------------------------------------------------------------------------
// Positive control: on the real repository, a fresh generation and the committed artifacts
// agree byte for byte. If this is red, every negative case below is meaningless -- the drift
// guard would be "always red", not a guard.
// ---------------------------------------------------------------------------------------
test('real repository: --check confirms zero drift', () => {
  const result = spawnSync(process.execPath, [GENERATOR_PATH, '--check'], { cwd: REPO_ROOT, encoding: 'utf8' });

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${outputOf(result)}`);
  assert.doesNotMatch(result.stdout, /Out of date/, result.stdout);
  assert.doesNotMatch(result.stderr, /Out of date/, result.stderr);
});

// ---------------------------------------------------------------------------------------
// T-01-18, mutation 1: the source changed, nobody regenerated. This is the exact failure the
// Phase 2 image tag depends on -- version lives in the source, the artifact carries it, and a
// stale artifact would tag an image from an older source.
// ---------------------------------------------------------------------------------------
test('--check fails and names the stale artifact when the source changed but was not regenerated', (t) => {
  const root = makeTempTree(t, (source) => {
    source.app.version = '0.1.1';
  });

  const before = artifactHashes(root);
  const result = runGenerator(root, ['--check']);
  const after = artifactHashes(root);

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);

  const output = outputOf(result);
  assert.match(output, /Out of date/, output);
  // Naming the file is the whole point: exit 1 alone would not say which artifact to fix.
  assert.match(output, /homeweave_app\/config\.yaml/, output);

  // Only config.yaml carries the version, so exactly one artifact is stale.
  assert.match(output, /1 artifact\(s\) out of date/, output);

  // --check is read-only: it reports drift, it never repairs it.
  assert.deepEqual(after, before, '--check modified an artifact; it must be read-only');
});

// ---------------------------------------------------------------------------------------
// T-01-18, mutation 2: an artifact was hand-edited (the D-07 block is the tempting target --
// someone "cleaning up" the commented-out ports block). The source is untouched, so only a
// byte comparison against fresh generation can catch this.
// ---------------------------------------------------------------------------------------
test('--check fails and names the hand-edited artifact', (t) => {
  const root = makeTempTree(t);
  const configPath = join(root, CONFIG_YAML_REL);

  const original = readFileSync(configPath, 'utf8');
  const handEdited = original.replace('# ports:\n', '');
  assert.notEqual(handEdited, original, 'fixture edit did not apply: the "# ports:" line was not found');
  writeFileSync(configPath, handEdited, 'utf8');

  const editedHash = sha256(configPath);
  const result = runGenerator(root, ['--check']);

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);

  const output = outputOf(result);
  assert.match(output, /Out of date/, output);
  assert.match(output, /homeweave_app\/config\.yaml/, output);

  assert.equal(sha256(configPath), editedHash, '--check rewrote the hand-edited artifact; it must be read-only');
});

// ---------------------------------------------------------------------------------------
// --check on a tree where the artifacts were never generated. A missing artifact is drift,
// not a pass: this is the state of a fresh clone, and Supervisor would find no app at all.
// ---------------------------------------------------------------------------------------
test('--check treats a missing artifact as drift', (t) => {
  const root = makeTempTree(t);
  rmSync(join(root, CONFIG_YAML_REL));

  const result = runGenerator(root, ['--check']);

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);
  const output = outputOf(result);
  assert.match(output, /Out of date/, output);
  assert.match(output, /artifact is missing/, output);
  assert.equal(existsSync(join(root, CONFIG_YAML_REL)), false, '--check created a missing artifact; it must be read-only');
});

// ---------------------------------------------------------------------------------------
// The drift guard must not double as a "pass anyway" path when the source itself is broken.
// A corrupt source means the guard cannot know what the correct bytes are -- it has to fail,
// with the generator's normal `Failed:` prefix, rather than silently report zero drift.
// ---------------------------------------------------------------------------------------
test('--check still fails on an unreadable source instead of reporting zero drift', (t) => {
  const root = makeTempTree(t);
  writeFileSync(join(root, 'homeweave_app', 'app-metadata.json'), '{ not json', 'utf8');

  const result = runGenerator(root, ['--check']);

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);
  const output = outputOf(result);
  assert.match(output, /^Failed: /m, output);
  assert.doesNotMatch(output, /checks passed/, output);
});

// ---------------------------------------------------------------------------------------
// T-01-19, fail-closed on the source: an unconsumed key. `app.watchdog = true` used to be
// silently dropped (exit 0, no watchdog in the artifact), which quietly breaks the promise
// that "the generator ran clean" means "the source was applied". It must now stop the run,
// and above all it must stop it BEFORE anything is rewritten.
// ---------------------------------------------------------------------------------------
test('an unconsumed source key fails the generator without rewriting either artifact', (t) => {
  const root = makeTempTree(t, (source) => {
    source.app.watchdog = true;
  });

  // Sentinel contents: if the generator writes at all, these change. This is how "no artifact
  // was rewritten" becomes an assertion instead of a hope.
  const sentinel = 'SENTINEL: written by the test, must survive a failed generation\n';
  writeFileSync(join(root, REPOSITORY_YAML_REL), sentinel, 'utf8');
  writeFileSync(join(root, CONFIG_YAML_REL), sentinel, 'utf8');

  const result = runGenerator(root);

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);

  const output = outputOf(result);
  // A formatted `Failed:` line, not a stack trace.
  assert.match(output, /^Failed: /m, output);
  // The message must name the offending source key, or the author cannot act on it.
  assert.match(output, /app\.watchdog is not consumed/, output);
  assert.doesNotMatch(output, /TypeError/, output);

  assert.equal(readFileSync(join(root, REPOSITORY_YAML_REL), 'utf8'), sentinel, 'repository.yaml was rewritten by a failed run');
  assert.equal(readFileSync(join(root, CONFIG_YAML_REL), 'utf8'), sentinel, 'config.yaml was rewritten by a failed run');
});

// ---------------------------------------------------------------------------------------
// T-01-23, source-side value guard on repository.yaml: a numeric maintainer used to sail
// straight through. `scalar(42)` emits `maintainer: 42`, which is valid YAML, so the generator
// exited 0 and only the Supervisor side would have complained -- the failure mode this whole
// guard exists to prevent, and one that `--check` cannot see either because the artifact it
// compares against was rebuilt from the same bad source.
// ---------------------------------------------------------------------------------------
test('a numeric repository.maintainer fails the generator without rewriting either artifact', (t) => {
  const root = makeTempTree(t, (source) => {
    source.repository.maintainer = 42;
  });

  const sentinel = 'SENTINEL: written by the test, must survive a failed generation\n';
  writeFileSync(join(root, REPOSITORY_YAML_REL), sentinel, 'utf8');
  writeFileSync(join(root, CONFIG_YAML_REL), sentinel, 'utf8');

  const result = runGenerator(root);

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);

  const output = outputOf(result);
  assert.match(output, /^Failed: /m, output);
  // Naming the key is what separates "stopped on the right assertion" from "stopped somewhere
  // else in the source and happened to exit 1".
  assert.match(output, /repository\.maintainer must be a non-empty string/, output);
  // A raw TypeError would mean the value guard is missing and something downstream crashed.
  assert.doesNotMatch(output, /TypeError/, output);

  assert.equal(readFileSync(join(root, REPOSITORY_YAML_REL), 'utf8'), sentinel, 'repository.yaml was rewritten by a failed run');
  assert.equal(readFileSync(join(root, CONFIG_YAML_REL), 'utf8'), sentinel, 'config.yaml was rewritten by a failed run');
});

// The remaining two source-side repository failures. Registered as separate tests (one per
// table entry, not one test looping internally) so a single broken branch cannot hide behind a
// green sibling.
//
// The two expected messages differ on purpose, and that difference is the assertion: deleting a
// key is caught much earlier, by assertConsumedKeys in main(), whose message is
// "repository.url is missing (the generator reads it)" -- it never reaches
// assertNonEmptyString. Asserting the same wording for both would let one of the two guards be
// removed while this table stayed green.
const REPOSITORY_SOURCE_FAILURES = [
  [
    'null',
    (source) => {
      source.repository.maintainer = null;
    },
    /repository\.maintainer must be a non-empty string/,
  ],
  [
    'missing url',
    (source) => {
      delete source.repository.url;
    },
    /repository\.url is missing/,
  ],
  // The two cases below exist to pin assertNonEmptyString on name/url, not just maintainer.
  // Deleting either call site must turn this table red, so each entry asserts the value-level
  // message ("must be a non-empty string"), never the presence-level one ("is missing").
  [
    'empty name',
    (source) => {
      source.repository.name = '';
    },
    /repository\.name must be a non-empty string/,
  ],
  [
    'empty url',
    (source) => {
      source.repository.url = '';
    },
    /repository\.url must be a non-empty string/,
  ],
];

for (const [label, mutate, expected] of REPOSITORY_SOURCE_FAILURES) {
  test(`a ${label} repository value fails the generator without rewriting either artifact`, (t) => {
    const root = makeTempTree(t, mutate);

    const sentinel = 'SENTINEL: written by the test, must survive a failed generation\n';
    writeFileSync(join(root, REPOSITORY_YAML_REL), sentinel, 'utf8');
    writeFileSync(join(root, CONFIG_YAML_REL), sentinel, 'utf8');

    const result = runGenerator(root);

    assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);

    const output = outputOf(result);
    assert.match(output, /^Failed: /m, output);
    assert.match(output, expected, output);
    assert.doesNotMatch(output, /TypeError/, output);

    assert.equal(readFileSync(join(root, REPOSITORY_YAML_REL), 'utf8'), sentinel, 'repository.yaml was rewritten by a failed run');
    assert.equal(readFileSync(join(root, CONFIG_YAML_REL), 'utf8'), sentinel, 'config.yaml was rewritten by a failed run');
  });
}

// ---------------------------------------------------------------------------------------
// T-01-19, renamed nested key: this used to flood stderr with
// `TypeError: Cannot read properties of undefined (reading 'type')` plus stack frames that
// point at internal functions. It must become a readable `Failed:` message naming the key
// path, with no stack at all.
// ---------------------------------------------------------------------------------------
test('a renamed optionDefs entry fails with a formatted message, not a stack trace', (t) => {
  const root = makeTempTree(t, (source) => {
    source.app.optionDefs.haURL = source.app.optionDefs.haUrl;
    delete source.app.optionDefs.haUrl;
  });

  const result = runGenerator(root);

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);

  const output = outputOf(result);
  assert.match(output, /^Failed: /m, output);
  assert.match(output, /optionDefs/, output);
  // The whole point: no raw TypeError, no stack frames naming generator internals.
  assert.doesNotMatch(output, /TypeError/, output);
  assert.doesNotMatch(output, /at buildSchemaDsl/, output);
  assert.doesNotMatch(output, /\n\s+at /, output);
});

// ---------------------------------------------------------------------------------------
// T-01-20: scalar round-trip. Seven values that a plain-scalar denylist got wrong -- the `&`
// case actually shipped (parsed back as "AI OS"), the flow/comment cases produced
// unparseable YAML, and the two whitespace cases are the ones that make the trim() guard
// load-bearing: without it they would parse back with the whitespace stripped.
//
// These assert the PARSED VALUE, never the quoting. Quote style is not part of the contract.
// ---------------------------------------------------------------------------------------
const TRICKY_DESCRIPTIONS = [
  '&anchor AI OS',
  'HomeWeave:',
  '[alpha] AI OS',
  '* HomeWeave notes',
  '@HomeWeave',
  ' AI OS',
  'AI OS ',
];

for (const description of TRICKY_DESCRIPTIONS) {
  test(`description ${JSON.stringify(description)} survives a generate/parse round trip verbatim`, (t) => {
    const root = makeTempTree(t, (source) => {
      source.app.description = description;
    });

    const generated = runGenerator(root);
    assert.equal(generated.status, 0, `expected exit 0, got ${generated.status}\n${outputOf(generated)}`);

    const parsed = parseYaml(readFileSync(join(root, CONFIG_YAML_REL), 'utf8'));
    assert.equal(
      parsed.description,
      description,
      `description was silently changed: source ${JSON.stringify(description)} -> artifact ${JSON.stringify(parsed.description)}`,
    );
  });
}

// ---------------------------------------------------------------------------------------
// Checkout line endings must not count as drift. This repository has core.autocrlf=true and
// no .gitattributes, so a fresh Windows clone produces CRLF artifacts while the generator
// always writes LF. A guard that goes red on a clean clone is worse than no guard: it trains
// people to bypass it. Verified against a real clone, not just this fixture.
// ---------------------------------------------------------------------------------------
test('--check tolerates CRLF artifacts produced by a Windows checkout', (t) => {
  const root = makeTempTree(t);
  for (const relativePath of [REPOSITORY_YAML_REL, CONFIG_YAML_REL]) {
    const path = join(root, relativePath);
    // Normalize to LF first: the seed is a copy of the real artifact, whose on-disk
    // line endings depend on core.autocrlf. Converting an already-CRLF file would
    // produce \r\r\n, which is a corrupt file, not a Windows checkout.
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
  }

  const result = runGenerator(root, ['--check']);

  assert.notEqual(result.status, null, `generator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `a CRLF checkout was reported as drift: ${result.status}\n${outputOf(result)}`);
  assert.doesNotMatch(outputOf(result), /Out of date/, outputOf(result));
});

test('--check still catches a real edit inside a CRLF artifact', (t) => {
  const root = makeTempTree(t);
  for (const relativePath of [REPOSITORY_YAML_REL, CONFIG_YAML_REL]) {
    const path = join(root, relativePath);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
  }

  const configPath = join(root, CONFIG_YAML_REL);
  const crlf = readFileSync(configPath, 'utf8');
  const edited = crlf.replace('# ports:\r\n', '');
  assert.notEqual(edited, crlf, 'fixture edit did not apply: the "# ports:" line was not found');
  writeFileSync(configPath, edited, 'utf8');

  const result = runGenerator(root, ['--check']);

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${outputOf(result)}`);
  const output = outputOf(result);
  assert.match(output, /Out of date/, output);
  assert.match(output, /homeweave_app\/config\.yaml/, output);
});

// ---------------------------------------------------------------------------------------
// Smoke: a full generate in a temp tree leaves no residual drift. This is the pair that
// proves the guard is a guard and not an "always red" check -- generate, then --check, both
// on the very same bytes.
// ---------------------------------------------------------------------------------------
test('generate then --check leaves zero residual drift', (t) => {
  const root = makeTempTree(t);

  const generated = runGenerator(root);
  assert.equal(generated.status, 0, `generate failed: ${generated.status}\n${outputOf(generated)}`);

  const checked = runGenerator(root, ['--check']);
  assert.equal(checked.status, 0, `--check after generate reported drift: ${checked.status}\n${outputOf(checked)}`);
  assert.doesNotMatch(outputOf(checked), /Out of date/, outputOf(checked));
});
