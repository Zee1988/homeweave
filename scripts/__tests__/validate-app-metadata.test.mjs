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
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  REPO_ROOT,
  cleanup,
  makeValidTree,
  runValidator,
  writeConfig,
  writeExtraConfig,
  writeRepository,
} from './fixtures.mjs';

/** Path of the generated app config inside a fixture tree. */
const CONFIG_PATH_IN_TREE = join('homeweave_app', 'config.yaml');

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
// V2 -- the remaining 9 required keys. Same discipline as the block above: one case per key,
// because deleting all of them at once would still exit 1 while proving nothing about which
// key triggers the check.
//
// Do not merge these into the loop above. The five original keys were the "obvious" ones and
// were already covered before the required set was widened to the full 14; keeping the two
// groups separate makes it visible at a glance which keys are newly guarded, and keeps the
// original cases byte-identical to the version that was reviewed.
// ---------------------------------------------------------------------------------------
for (const key of [
  'url',
  'init',
  'image',
  'homeassistant',
  'homeassistant_api',
  'ingress',
  'ingress_port',
  'options',
  'schema',
]) {
  test(`V2: missing required key "${key}" is rejected`, (t) => {
    const root = makeValidTree();
    t.after(() => cleanup(root));
    writeConfig(root, (config) => {
      delete config[key];
    });

    const result = runValidator(root);

    assertDetects(result, 'V2', `missing ${key}`);
    // The message has to name the deleted key. Without this, a cascading failure on a
    // neighbouring key (delete "options", hear about "schema" via V11) would be mistaken for
    // a detection of the key we actually removed.
    assert.match(result.stdout, new RegExp(`"${key}"`), `${key} not named in the failure\n${result.stdout}`);
    // A tree with a required key removed must never report success. Written out explicitly so
    // a future refactor that turns V2 back into a soft warning cannot pass silently.
    assert.doesNotMatch(result.stdout, /checks passed/, `missing ${key} still reported success\n${result.stdout}`);
  });
}

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

// ---------------------------------------------------------------------------------------
// V15 -- exactly one Supervisor-discoverable config file (ROADMAP success criterion 2).
// Supervisor discovers apps with glob("**\/config.*"), so a second config.yaml anywhere in
// the tree becomes a second app: installing the repo would show two entries, one of them
// pointing at files nobody maintains.
// ---------------------------------------------------------------------------------------
test('V15: a second config.yaml outside homeweave_app/ is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeExtraConfig(root, 'nested/config.yaml');

  assertDetects(runValidator(root), 'V15', 'second config.yaml');
});

// The other half of V15. The skip list (dot-prefixed segments, rootfs) must skip only what
// Supervisor skips. Pairing this with the case above is what makes the check meaningful: if
// the skip list were inverted, the previous test would still pass and this one would go red.
test('V15: dotted and rootfs copies of config.yaml do not count', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeExtraConfig(root, '.hidden/config.yaml');
  writeExtraConfig(root, 'rootfs/etc/config.yaml');

  const result = runValidator(root);

  assert.notEqual(result.status, null, `validator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `skipped paths must not count, got exit ${result.status}\n${result.stdout}`);
});

// ---------------------------------------------------------------------------------------
// V13 -- no generic placeholder may survive into the generated files.
// Only the url value changes; the three repository keys stay, so V3 cannot mask the signal.
// The validator does not fail fast, so V13 may appear alongside other codes -- we assert
// that V13 is reported, not that it is the only failure.
// ---------------------------------------------------------------------------------------
test('V13: an angle-bracket owner placeholder in repository.yaml is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    repository.url = 'https://github.com/<owner>/homeweave';
  });

  assertDetects(runValidator(root), 'V13', 'placeholder owner');
});

// ---------------------------------------------------------------------------------------
// V11 -- schema and options are two halves of one contract. Both directions get a case so
// the check cannot be implemented as "always strict" (which would make every app with an
// optional setting invalid) or as "always lenient".
// ---------------------------------------------------------------------------------------
test('V11: a schema key with no default and no "?" is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.schema.verbose = 'bool';
  });

  assertDetects(runValidator(root), 'V11', 'schema.verbose without default');
});

test('V11: an optional schema key ("?") needs no default in options', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.schema.debug_flag = 'bool?';
  });

  const result = runValidator(root);

  assert.notEqual(result.status, null, `validator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `optional key must not require a default, got exit ${result.status}\n${result.stdout}`);
});

// ---------------------------------------------------------------------------------------
// V16 -- the "YAML parsed this into something else" family. Four shapes, one case each:
// a list, a number, a string that is not x.y.z, and a string that is not a valid slug.
// All four are object-level mutations: none of them depends on how the YAML was quoted.
// ---------------------------------------------------------------------------------------
test('V16: slug with uppercase and a space is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.slug = 'HomeWeave bad';
  });

  const result = runValidator(root);

  assertDetects(result, 'V16', 'slug=HomeWeave bad');
  assert.match(result.stdout, /"slug"/, `slug not named in the failure\n${result.stdout}`);
});

test('V16: a numeric name is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.name = 12345;
  });

  const result = runValidator(root);

  assertDetects(result, 'V16', 'name=12345');
  assert.match(result.stdout, /"name"/, `name not named in the failure\n${result.stdout}`);
});

test('V16: homeassistant that is not x.y.z is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    // Unquoted 2026.1 is parsed as the float 2026.1: the trailing component is gone.
    config.homeassistant = '2026.1';
  });

  const result = runValidator(root);

  assertDetects(result, 'V16', 'homeassistant=2026.1');
  assert.match(result.stdout, /"homeassistant"/, `homeassistant not named in the failure\n${result.stdout}`);
});

test('V16: a list description is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.description = ['alpha'];
  });

  const result = runValidator(root);

  assertDetects(result, 'V16', 'description=[alpha]');
  assert.match(result.stdout, /"description"/, `description not named in the failure\n${result.stdout}`);
});

// The positive control that makes V16 trustworthy: it must not depend on quote style. The
// fixture serializer never quotes "2026.10.0" (it is a plain scalar), so this quoted form can
// only be produced by rewriting the source text -- an object-level mutation cannot express it.
// Rewriting line by line, matching the FIRST line that starts with "homeassistant:", avoids a
// whole-text regex accidentally touching a same-named substring elsewhere in the file.
test('V16: a quoted homeassistant with the same value still passes', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));

  const configPath = join(root, CONFIG_PATH_IN_TREE);
  const text = readFileSync(configPath, 'utf8');
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.startsWith('homeassistant:'));
  assert.notEqual(index, -1, `fixture baseline has no homeassistant: line\n${text}`);
  lines[index] = 'homeassistant: "2026.10.0"';
  writeFileSync(configPath, lines.join('\n'), 'utf8');

  const result = runValidator(root);

  assert.notEqual(result.status, null, `validator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `quote style must not matter, got exit ${result.status}\n${result.stdout}`);
  assert.match(result.stdout, /checks passed/, result.stdout);
});

// ---------------------------------------------------------------------------------------
// Closing gate: after every fixture above has been cleaned up, the repository tree itself
// must still validate. This turns "fixtures must never leak into the repo" from a code
// review habit into an automated conclusion -- a leaked config.yaml fails V15 here.
// ---------------------------------------------------------------------------------------
test('closing gate: the repository tree validates with no fixture residue', () => {
  const result = runValidator(REPO_ROOT);

  assert.notEqual(result.status, null, `validator process never started (${result.error?.message ?? 'unknown'})`);
  assert.equal(result.status, 0, `repo tree must validate, got exit ${result.status}\n${result.stdout}`);
  assert.match(result.stdout, /checks passed/, result.stdout);
});
