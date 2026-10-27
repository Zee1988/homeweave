/**
 * Negative-case proof suite for scripts/validate-app-metadata.mjs.
 *
 * What this proves: the validator *detects known-bad input*. Every case builds a temp tree
 * that is legal except for one injected defect, runs the real validator against it, and
 * asserts three things together:
 *
 *   - status === 1                       the defect makes the gate fail
 *   - status !== null                    the child actually ran (a spawn failure is not a detection)
 *   - stdout contains the expected check code   the failure is the intended one, not collateral
 *
 * A positive control runs first: a fully legal temp tree must exit 0. Without it, the
 * negative cases could all be satisfied by a validator that always exits 1.
 *
 * What this does NOT prove: that Supervisor accepts the metadata. That is runtime behaviour
 * of vol.Schema (RE_SLUG / version_tag / docker_image) and stays HAOS-unverified.
 *
 * Discipline: no assertion looks at YAML quote style or raw source text. Single and double
 * quotes are semantically equivalent in YAML, so asserting on them would produce false reds.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanup,
  makeValidTree,
  runValidator,
  writeConfig,
} from './fixtures.mjs';

/** Assert a run failed with the given check code and nothing else was assumed. */
function assertDetects(result, code, label) {
  assert.notEqual(
    result.status,
    null,
    `${label}: validator process never started (${result.error?.message ?? 'unknown spawn error'})`,
  );
  assert.equal(result.status, 1, `${label}: expected exit 1, got ${result.status}\n${result.stdout}`);
  assert.match(result.stdout, new RegExp(`✗ ${code} `), `${label}: exit 1 but ${code} not reported\n${result.stdout}`);
}

// ---------------------------------------------------------------------------------------
// Positive control. Defined first and runs first: if the baseline itself is broken, every
// failure below is meaningless, so this has to be green before anything else is trusted.
// ---------------------------------------------------------------------------------------
test('positive control: a legal temp tree passes', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));

  const result = runValidator(root);

  assert.notEqual(result.status, null, `validator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}`);
  assert.match(result.stdout, /checks passed/, result.stdout);
});

// ---------------------------------------------------------------------------------------
// V2 -- the five required keys. One case per key on purpose: deleting all five at once
// would still exit 1 while proving nothing about which key actually triggers the check.
// ---------------------------------------------------------------------------------------
for (const key of ['name', 'slug', 'version', 'description', 'arch']) {
  test(`V2: missing required key "${key}" is rejected`, (t) => {
    const root = makeValidTree();
    t.after(() => cleanup(root));
    writeConfig(root, (config) => {
      delete config[key];
    });

    const result = runValidator(root);

    assertDetects(result, 'V2', `missing ${key}`);
    assert.match(result.stdout, new RegExp(`"${key}"`), `${key} not named in the failure\n${result.stdout}`);
  });
}

// ---------------------------------------------------------------------------------------
// V5 -- arch must stay inside the declared multi-arch subset.
// ---------------------------------------------------------------------------------------
test('V5: arch containing i386 is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.arch = ['amd64', 'i386'];
  });

  assertDetects(runValidator(root), 'V5', 'arch=i386');
});

// ---------------------------------------------------------------------------------------
// V6 -- image must be tag-free; the tag is derived from version at build time.
// ---------------------------------------------------------------------------------------
test('V6: image carrying an explicit tag is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.image = `${config.image}:0.1.0`;
  });

  assertDetects(runValidator(root), 'V6', 'image with tag');
});

// ---------------------------------------------------------------------------------------
// V8 -- key whitelist, the highest-value check in this phase.
// Supervisor builds its config schema with extra=vol.REMOVE_EXTRA, so a misspelled key such
// as "ingresss" is silently dropped: the app simply behaves as if the key were never
// written, with no error and no warning anywhere. Such a typo passes Supervisor 100% of the
// time -- this whitelist is the only thing that can catch it, which is why it gets a
// negative case of its own.
// ---------------------------------------------------------------------------------------
test('V8: a misspelled key (ingresss) is rejected instead of silently dropped', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.ingresss = true;
  });

  assertDetects(runValidator(root), 'V8', 'unknown key ingresss');
});
