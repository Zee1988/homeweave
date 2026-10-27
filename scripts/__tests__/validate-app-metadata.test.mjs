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

// Two branches the four cases above do not reach, both added because "the code exists" is not
// the same as "the failing branch is proven to fire":
//
//   - an empty string, which is a string and therefore passes any typeof check;
//   - a value that really is a string but is not x.y.z. The 2026.1 case above cannot cover this
//     one: unquoted 2026.1 is parsed as a FLOAT, so it exercises the not-a-string branch. Getting
//     a string requires a value the fixture serializer has to quote -- a space is enough.
test('V16: an empty name is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.name = '';
  });

  const result = runValidator(root);

  assertDetects(result, 'V16', 'name is empty');
  assert.match(result.stdout, /"name"/, `name not named in the failure\n${result.stdout}`);
});

test('V16: a homeassistant string that is not x.y.z is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.homeassistant = '2026.10 beta';
  });

  const result = runValidator(root);

  assertDetects(result, 'V16', 'homeassistant="2026.10 beta"');
  // Matched on the V16 wording specifically. Changing homeassistant also breaks the V17 contract
  // literal, so asserting only the code would let this case pass on V17's back.
  assert.match(
    result.stdout,
    /✗ V16 .*"homeassistant" must look like <major>\.<minor>\.<patch>/,
    `the format branch of V16 did not fire\n${result.stdout}`,
  );
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
// V17 -- the contract literals (D-01a / D-03a). Each case changes the value in a way that every
// other check would happily accept: a different-but-valid owner, a different-but-valid version,
// a different-but-valid minimum HA version. Only V17 can tell these apart from the contract.
// ---------------------------------------------------------------------------------------
test('V17: a different image owner is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.image = 'ghcr.io/somebody-else/totally-different';
  });

  assertDetects(runValidator(root), 'V17', 'image owner swap');
});

test('V17: a bumped version is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.version = '0.1.1';
  });

  assertDetects(runValidator(root), 'V17', 'version=0.1.1');
});

test('V17: a different homeassistant minimum is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeConfig(root, (config) => {
    config.homeassistant = '2026.10.9';
  });

  assertDetects(runValidator(root), 'V17', 'homeassistant=2026.10.9');
});

// ---------------------------------------------------------------------------------------
// V19 -- the repository.yaml sibling of V2 / V16.
// Before this, repository.yaml had exactly one value guard: V3 on "name". Everything else was
// unguarded, so `maintainer: 42`, `maintainer: null`, `url: true` and a deleted "url" or
// "maintainer" line all validated clean. That matters more than a normal gap: repository.yaml is
// the whole-repository manifest, so one bad value makes Supervisor reject the entire repository
// and no app appears at all.
// ---------------------------------------------------------------------------------------
test('V19: a numeric maintainer is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    repository.maintainer = 42;
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'maintainer=42');
  // Both extra assertions are load-bearing. Asserting only the code would let a failure reported
  // against "name" pass as a detection of "maintainer", and only the type word proves the type
  // loop (not the presence loop) is the one that fired.
  assert.match(result.stdout, /"maintainer"/, `maintainer not named in the failure\n${result.stdout}`);
  assert.match(result.stdout, /got number/, `the type branch did not fire\n${result.stdout}`);
});

// One case per key, same discipline as V2's two blocks: deleting all three at once would still
// exit 1 while proving nothing about which key inside repository.yaml is actually required.
// The doesNotMatch(/checks passed/) assertions are written out explicitly so a future refactor
// that demotes presence to a soft warning cannot pass silently.
test('V19: missing required key "url" is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    delete repository.url;
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'missing url');
  assert.match(result.stdout, /"url"/, `url not named in the failure\n${result.stdout}`);
  assert.doesNotMatch(result.stdout, /checks passed/, `a missing repository key still reported success\n${result.stdout}`);
});

test('V19: missing required key "maintainer" is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    delete repository.maintainer;
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'missing maintainer');
  assert.match(result.stdout, /"maintainer"/, `maintainer not named in the failure\n${result.stdout}`);
  assert.doesNotMatch(result.stdout, /checks passed/, `a missing repository key still reported success\n${result.stdout}`);
});

test('V19: missing required key "name" is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    delete repository.name;
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'missing name');
  assert.match(result.stdout, /"name"/, `name not named in the failure\n${result.stdout}`);
  // Deliberately NOT asserting "only V19 fires": V3 also guards "name" and reports it, and that
  // double report is the intended behaviour (this validator only forbids under-reporting).
});

test('V19: a null maintainer is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    repository.maintainer = null;
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'maintainer=null');
  assert.match(result.stdout, /"maintainer"/, `maintainer not named in the failure\n${result.stdout}`);
  // "got null" rather than "got object": describe() special-cases null, and asserting the word
  // is what proves the type branch fired on the value we injected.
  assert.match(result.stdout, /got null/, `the type branch did not report null\n${result.stdout}`);
});

test('V19: a boolean url is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    repository.url = true;
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'url=true');
  assert.match(result.stdout, /"url"/, `url not named in the failure\n${result.stdout}`);
  assert.match(result.stdout, /got boolean/, `the type branch did not report a boolean\n${result.stdout}`);
});

test('V19: an empty-string maintainer is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    repository.maintainer = '';
  });

  const result = runValidator(root);

  assertDetects(result, 'V19', 'maintainer=""');
  assert.match(result.stdout, /"maintainer"/, `maintainer not named in the failure\n${result.stdout}`);
  // "" IS a string, so a bare typeof check would accept it. Only the non-empty clause catches
  // this case -- which is exactly why the type word here is "string", not something else.
  assert.match(result.stdout, /got string/, `the empty-string branch did not fire\n${result.stdout}`);
});

// ---------------------------------------------------------------------------------------
// V8, repository side. V8 already rejected unknown keys in config.yaml (proven above by the
// "ingresss" and "uncommented ports" cases), but its repository.yaml branch had no negative case
// at all -- so "unknown keys are rejected" was only half-proven, and the repository half could
// have been inverted without any test going red.
// ---------------------------------------------------------------------------------------
test('V8: an unknown repository key is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));
  writeRepository(root, (repository) => {
    repository.owner = 'Zee';
  });

  const result = runValidator(root);

  assertDetects(result, 'V8', 'unknown repository key owner');
  assert.match(result.stdout, /"owner"/, `the unknown key was not named\n${result.stdout}`);
});

// ---------------------------------------------------------------------------------------
// V18 / the V8 complement -- the two halves of D-07 ("ports stays commented until Phase 5").
//
// Deleting a comment cannot be expressed as an object-level mutation, so this case rewrites the
// source text. The existence assertion before deletion is what keeps it from being a vacuous
// run: without it, a baseline that never carried the block would "pass" this test by deleting
// nothing at all.
// ---------------------------------------------------------------------------------------
test('V18: deleting the commented ports block is rejected', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));

  const configPath = join(root, CONFIG_PATH_IN_TREE);
  const text = readFileSync(configPath, 'utf8');
  assert.ok(/^# ports:/m.test(text), `baseline has no "# ports:" line to delete\n${text}`);
  assert.ok(text.includes('8124/tcp'), `baseline has no "8124/tcp" marker to delete\n${text}`);

  const stripped = text
    .split('\n')
    .filter((line) => !line.startsWith('# ports:') && !line.includes('8124/tcp'))
    .join('\n');
  assert.doesNotMatch(stripped, /^# ports:/m, `the "# ports:" line survived the rewrite\n${stripped}`);
  writeFileSync(configPath, stripped, 'utf8');

  assertDetects(runValidator(root), 'V18', 'deleted ports comment block');
});

// The complement. Uncommenting the block turns ports into a live key, which is the other way
// D-07 can be broken -- and the one V18 alone would NOT catch, since "8124/tcp" survives the
// edit. V8's unknown-key rejection is what closes that path; pairing the two proves neither
// check is redundant.
test('V8: uncommenting ports is rejected as an unknown key', (t) => {
  const root = makeValidTree();
  t.after(() => cleanup(root));

  const configPath = join(root, CONFIG_PATH_IN_TREE);
  const text = readFileSync(configPath, 'utf8');
  assert.ok(/^# ports:/m.test(text), `baseline has no "# ports:" line to uncomment\n${text}`);

  const enabled = text
    .replace(/^# ports:$/m, 'ports:')
    .replace(/^#   8124\/tcp: 8124$/m, '  8124/tcp: 8124');
  assert.doesNotMatch(enabled, /^# ports:$/m, `the "# ports:" line was not uncommented\n${enabled}`);
  writeFileSync(configPath, enabled, 'utf8');

  assertDetects(runValidator(root), 'V8', 'uncommented ports');
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
