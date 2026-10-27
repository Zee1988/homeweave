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
