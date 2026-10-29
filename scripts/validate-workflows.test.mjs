import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  CI_GATE_TOKENS,
  EDGES,
  PROFILES,
  REQUIRED_PLATFORMS,
  checkBuildPushFlags,
  checkCiGates,
  checkDispatch,
  checkFiles,
  checkJobGraph,
  checkJobsHaveCheckout,
  checkNeedsReferences,
  checkNoPrivilegedPrTrigger,
  checkNoShellBuild,
  checkPermissions,
  checkPinnedActions,
  checkResumePath,
  checkStepRuns,
  checkTagGate,
  main,
  parseArgs,
  validateWorkflows,
} from './validate-workflows.mjs';

// Fixtures are deliberately valid: every red case below mutates a parsed copy, so
// a red result can only come from the one thing that was broken.

const CI_YAML = `on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: corepack pnpm validate:workflows:ci
      - run: corepack pnpm validate:app
      - run: corepack pnpm validate:dockerfile
      - run: corepack pnpm lint
      - run: corepack pnpm typecheck
      - run: corepack pnpm test
      - run: corepack pnpm check:app
`;

const RELEASE_YAML = `on:
  workflow_dispatch:
    inputs:
      version:
        required: true
        type: string
      confirm_version:
        required: true
        type: string
      resume_from_verify:
        type: boolean
        default: false
permissions:
  contents: read
jobs:
  guard:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    outputs:
      version: \${{ steps.read.outputs.version }}
      ref: \${{ steps.read.outputs.ref }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - id: read
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          node scripts/check-tag-free.mjs "$REF" --expect free --allow-missing-package
          node scripts/check-tag-free.mjs "$REF" --expect exists
  static:
    needs: guard
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: corepack pnpm validate:workflows:release
  publish:
    needs: [guard, static]
    if: \${{ !inputs.resume_from_verify }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - env:
          GH_TOKEN: \${{ github.token }}
        run: node scripts/check-tag-free.mjs "$REF" --expect free --allow-missing-package
      - uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          sbom: false
          tags: \${{ needs.guard.outputs.ref }}
  verify-image:
    needs: [guard, publish, static]
    if: \${{ always() && needs.static.result == 'success' && (needs.publish.result == 'success' || (inputs.resume_from_verify && needs.publish.result == 'skipped')) }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - run: |
          docker logout ghcr.io || true
          printf '{}' > "$HOME/.docker/config.json"
          docker pull ghcr.io/zee1988/homeweave-ha-app:\${{ needs.guard.outputs.version }}
      - run: bash scripts/ci/assert-image.sh ghcr.io/zee1988/homeweave-ha-app:\${{ needs.guard.outputs.version }}
      - run: node scripts/assert-manifest-platforms.mjs ghcr.io/zee1988/homeweave-ha-app:\${{ needs.guard.outputs.version }} "\${{ needs.guard.outputs.version }}"
  tag:
    needs: [guard, verify-image]
    if: \${{ always() && needs.guard.result == 'success' && needs.verify-image.result == 'success' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: |
          git config user.email "homeweave-release-bot@users.noreply.github.com"
          git config user.name "homeweave-release-bot"
          git tag -a "\$VERSION" -m "release \$VERSION"
          git push origin "\$VERSION"
`;

// The CLI's snippet sets, as literals: importing them would make the test agree
// with whatever the module happens to say.
const GUARD_SNIPPETS = [
  'check-tag-free.mjs',
  '--expect free',
  '--expect exists',
  '--allow-missing-package',
  'GH_TOKEN',
];
const PUBLISH_SNIPPETS = ['check-tag-free.mjs', '--allow-missing-package', 'GH_TOKEN'];
const VERIFY_IMAGE_SNIPPETS = [
  'assert-image.sh',
  'assert-manifest-platforms.mjs',
  'docker logout',
  '.docker/config.json',
  'docker pull',
];
const TAG_SNIPPETS = ['git config user.email', 'git tag', 'git push'];

const parse = (text) => yaml.load(text);
const ci = () => parse(CI_YAML);
const release = () => parse(RELEASE_YAML);

const stepIndexWhere = (doc, jobName, predicate) => {
  const index = doc.jobs[jobName].steps.findIndex(predicate);
  assert.notEqual(index, -1, `fixture no longer contains the step this test needs in "${jobName}"`);
  return index;
};

const buildPushIndex = (doc) =>
  stepIndexWhere(doc, 'publish', (step) => String(step.uses ?? '').startsWith('docker/build-push-action@'));

const isGreen = (problems) => {
  assert.deepEqual(problems, [], `expected no problems, got:\n${problems.join('\n')}`);
};

const isRed = (problems, matcher) => {
  assert.ok(problems.length > 0, 'expected at least one problem, got none');
  if (matcher !== undefined) {
    assert.ok(
      problems.some((problem) => problem.includes(matcher)),
      `expected a problem mentioning "${matcher}", got:\n${problems.join('\n')}`,
    );
  }
};

/** Runs `body` against a throwaway cwd holding (or not holding) workflow files. */
function withWorkflows(files, body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'homeweave-workflows-'));
  try {
    const names = Object.keys(files);
    if (names.length > 0) {
      mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
      for (const name of names) {
        writeFileSync(path.join(dir, '.github', 'workflows', name), files[name], 'utf8');
      }
    }
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the ci fixture passes every ci rule', () => {
  const doc = ci();
  isGreen(checkNoPrivilegedPrTrigger(doc));
  isGreen(checkPermissions(doc, { packagesWrite: [], contentsWrite: [] }));
  isGreen(checkPinnedActions(doc));
  isGreen(checkJobGraph(doc, EDGES.ci));
  isGreen(checkNeedsReferences(doc));
  isGreen(checkCiGates(doc));
  isGreen(checkJobsHaveCheckout(doc));
});

test('the release fixture passes every release rule', () => {
  const doc = release();
  isGreen(checkNoPrivilegedPrTrigger(doc));
  isGreen(checkDispatch(doc));
  isGreen(checkPermissions(doc, { packagesWrite: ['publish'], contentsWrite: ['tag'] }));
  isGreen(checkPinnedActions(doc));
  isGreen(checkJobGraph(doc, EDGES.release));
  isGreen(checkNeedsReferences(doc));
  isGreen(checkResumePath(doc));
  isGreen(checkBuildPushFlags(doc, 'publish'));
  isGreen(checkNoShellBuild(doc, 'publish'));
  isGreen(checkStepRuns(doc, 'guard', GUARD_SNIPPETS));
  isGreen(checkStepRuns(doc, 'publish', PUBLISH_SNIPPETS));
  isGreen(checkStepRuns(doc, 'verify-image', VERIFY_IMAGE_SNIPPETS));
  isGreen(checkStepRuns(doc, 'tag', TAG_SNIPPETS));
  isGreen(checkTagGate(doc));
  isGreen(checkJobsHaveCheckout(doc));
});

// The real 2026-10-28 failure: publish read needs.guard.outputs.ref while only
// depending on static. GitHub expands that to "" -- docker then reports
// "invalid reference format", naming everything except the actual mistake.
test('a job reading needs.X.outputs must declare X in needs', () => {
  const doc = release();
  doc.jobs.publish.needs = 'static';
  const problems = checkNeedsReferences(doc);
  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /job "publish" references needs\.guard/);
  assert.match(problems[0], /does not list "guard" in needs/);
});

test('needs.X.result counts as a reference, not just needs.X.outputs', () => {
  const doc = release();
  doc.jobs['verify-image'].needs = ['publish'];
  const problems = checkNeedsReferences(doc);
  assert.ok(problems.length > 0, 'a .result reference to an undeclared job must be reported');
  assert.ok(
    problems.some((detail) => /needs\.static/.test(detail)),
    `expected a needs.static problem, got ${JSON.stringify(problems)}`,
  );
});

test('a reference to a job that does not exist is reported separately', () => {
  const doc = release();
  doc.jobs.publish.steps.push({ run: 'echo needs.ghost.outputs.ref' });
  const problems = checkNeedsReferences(doc);
  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /not a job in this workflow/);
});

test('a job referencing its own outputs is reported as a self-dependency', () => {
  const doc = release();
  doc.jobs.static.steps.push({ run: 'echo needs.static.outputs.version' });
  const problems = checkNeedsReferences(doc);
  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /cannot depend on itself/);
});

test('the exported constants describe the contract', () => {
  assert.deepEqual(REQUIRED_PLATFORMS, ['linux/amd64', 'linux/arm64']);
  assert.deepEqual(EDGES.release.publish, ['guard', 'static']);
  assert.deepEqual(EDGES.release['verify-image'], ['guard', 'publish', 'static']);
  assert.deepEqual(EDGES.release.tag, ['guard', 'verify-image']);
  assert.equal(CI_GATE_TOKENS.length, 7);
  assert.deepEqual(PROFILES.all, ['ci.yml', 'release.yml']);
});

// --- checkFiles: a missing file must never read as "nothing to check" --------

test('checkFiles reports a missing ci.yml instead of passing', () => {
  withWorkflows({}, (dir) => {
    isRed(checkFiles('ci', dir), 'missing workflow file');
  });
});

test('checkFiles does not complain about files another profile does not need', () => {
  withWorkflows({ 'ci.yml': CI_YAML }, (dir) => {
    const problems = checkFiles('release', dir);
    isRed(problems, 'release.yml');
    assert.ok(!problems.some((problem) => problem.includes('ci.yml')));
  });
});

test('checkFiles requires both files for the all profile', () => {
  withWorkflows({ 'ci.yml': CI_YAML }, (dir) => {
    isRed(checkFiles('all', dir), 'release.yml');
  });
});

test('checkFiles is green when the required files exist', () => {
  withWorkflows({ 'ci.yml': CI_YAML, 'release.yml': RELEASE_YAML }, (dir) => {
    isGreen(checkFiles('all', dir));
    isGreen(checkFiles('ci', dir));
    isGreen(checkFiles('release', dir));
  });
});

// --- checkNoPrivilegedPrTrigger (T-02-06) ------------------------------------

test('pull_request_target is rejected', () => {
  const doc = ci();
  doc.on = { pull_request_target: { branches: ['main'] } };
  isRed(checkNoPrivilegedPrTrigger(doc), 'pull_request_target');
});

test('pull_request is accepted', () => {
  isGreen(checkNoPrivilegedPrTrigger(ci()));
});

test('the scalar `on:` shorthand is still inspected', () => {
  const doc = ci();
  doc.on = 'pull_request_target';
  isRed(checkNoPrivilegedPrTrigger(doc), 'pull_request_target');
});

// --- checkPermissions (T-02-06) ---------------------------------------------

test('a workflow that declares no permissions is rejected', () => {
  const doc = ci();
  delete doc.permissions;
  isRed(checkPermissions(doc, {}), 'must be declared');
});

test('a top-level scope other than contents: read is rejected', () => {
  const doc = ci();
  doc.permissions = { contents: 'read', packages: 'read' };
  isRed(checkPermissions(doc, {}), 'extra scope');
});

test('top-level contents must literally be read', () => {
  const doc = ci();
  doc.permissions = { contents: 'write' };
  isRed(checkPermissions(doc, {}), 'permissions.contents');
});

test('packages: write outside the allowed job is rejected', () => {
  const doc = release();
  doc.jobs.static.permissions = { contents: 'read', packages: 'write' };
  isRed(checkPermissions(doc, { packagesWrite: ['publish'], contentsWrite: ['tag'] }), 'packages: write');
});

test('contents: write outside the allowed job is rejected', () => {
  const doc = release();
  doc.jobs['verify-image'].permissions = { contents: 'write' };
  isRed(checkPermissions(doc, { packagesWrite: ['publish'], contentsWrite: ['tag'] }), 'contents: write');
});

test('an allow-list entry naming a job that does not exist is rejected', () => {
  const doc = release();
  isRed(checkPermissions(doc, { packagesWrite: ['publish', 'ghost'], contentsWrite: ['tag'] }), 'ghost');
});

// --- checkPinnedActions ------------------------------------------------------

test('an action pinned to @main is rejected', () => {
  const doc = ci();
  doc.jobs.static.steps[0].uses = 'actions/checkout@main';
  isRed(checkPinnedActions(doc), 'actions/checkout@main');
});

test('an action with no ref is rejected', () => {
  const doc = ci();
  doc.jobs.static.steps[0].uses = 'actions/checkout';
  isRed(checkPinnedActions(doc), 'actions/checkout');
});

test('a major-version pin is accepted', () => {
  isGreen(checkPinnedActions(ci()));
});

// --- checkJobGraph: the ordering guarantee itself ---------------------------

test('tag without verify-image in needs is rejected', () => {
  const doc = release();
  doc.jobs.tag.needs = ['guard'];
  isRed(checkJobGraph(doc, EDGES.release), 'verify-image');
});

test('verify-image without publish in needs is rejected', () => {
  const doc = release();
  doc.jobs['verify-image'].needs = ['static'];
  isRed(checkJobGraph(doc, EDGES.release), 'publish');
});

test('a job other than verify-image may not depend on publish', () => {
  const doc = release();
  doc.jobs.tag.needs = ['guard', 'verify-image', 'publish'];
  isRed(checkJobGraph(doc, EDGES.release), 'must not include "publish"');
});

test('a missing job is reported rather than silently skipped', () => {
  const doc = release();
  delete doc.jobs.tag;
  isRed(checkJobGraph(doc, EDGES.release), 'tag');
});

// --- checkBuildPushFlags (D-5) and the string-vs-boolean trap ----------------

test('a publish job with no build-push step is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps.splice(buildPushIndex(doc), 1);
  isRed(checkBuildPushFlags(doc, 'publish'), 'docker/build-push-action@');
});

test('a quoted provenance: "false" is rejected -- it does not disable provenance', () => {
  const doc = parse(RELEASE_YAML.replace('provenance: false', 'provenance: "false"'));
  const problems = checkBuildPushFlags(doc, 'publish');
  isRed(problems, 'with.provenance');
  assert.ok(
    problems.some((problem) => problem.includes('string "false"')),
    'the message must name the string-vs-boolean cause, not just "wrong value"',
  );
});

test('a boolean provenance: false is accepted -- the contrast case above', () => {
  const doc = release();
  assert.equal(doc.jobs.publish.steps[buildPushIndex(doc)].with.provenance, false);
  isGreen(checkBuildPushFlags(doc, 'publish'));
});

test('sbom: true is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.sbom = true;
  isRed(checkBuildPushFlags(doc, 'publish'), 'with.sbom');
});

test('push: false is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.push = false;
  isRed(checkBuildPushFlags(doc, 'publish'), 'with.push');
});

test('a single-platform build is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.platforms = 'linux/amd64';
  isRed(checkBuildPushFlags(doc, 'publish'), 'with.platforms');
});

test('a stray third platform is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.platforms = 'linux/amd64,linux/arm64,linux/arm/v7';
  isRed(checkBuildPushFlags(doc, 'publish'), 'with.platforms');
});

test('a semver tag rule is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.tags = 'type=semver,pattern={{version}}';
  isRed(checkBuildPushFlags(doc, 'publish'), 'tags');
});

// The exact string this validator used to REQUIRE. build-push-action passes it
// to buildx verbatim and buildx answers "invalid reference format", which is how
// the 2026-10-28 release run failed after the needs bug was fixed.
test('metadata-action type=raw syntax is rejected as a tag reference', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.tags =
    'type=raw,value=ghcr.io/zee1988/homeweave-ha-app:0.1.0';
  isRed(checkBuildPushFlags(doc, 'publish'), 'metadata-action syntax');
});

test('a hard-coded tag instead of needs.guard.outputs.ref is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.tags = 'ghcr.io/zee1988/homeweave-ha-app:0.1.0';
  isRed(checkBuildPushFlags(doc, 'publish'), 'needs.guard.outputs.ref');
});

test('an empty build context is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps[buildPushIndex(doc)].with.context = '';
  isRed(checkBuildPushFlags(doc, 'publish'), 'with.context');
});

// --- checkNoShellBuild -------------------------------------------------------

test('a shell docker buildx build --push is rejected', () => {
  const doc = release();
  doc.jobs.publish.steps.push({ run: 'docker buildx build --platform linux/amd64 --push .' });
  const problems = checkNoShellBuild(doc, 'publish');
  isRed(problems, 'docker buildx build');
  assert.ok(
    problems.some((problem) => problem.includes('docker/build-push-action@')),
    'the message must say what to use instead',
  );
});

// --- checkStepRuns: the value surface is not just `run` ---------------------

test('a missing snippet is reported', () => {
  const doc = release();
  doc.jobs.guard.steps[2].run = 'node scripts/check-tag-free.mjs "$REF"';
  isRed(checkStepRuns(doc, 'guard', GUARD_SNIPPETS), '--expect free');
});

test('a snippet that only appears as an env value still counts', () => {
  const doc = release();
  delete doc.jobs.guard.steps[2].run;
  isGreen(checkStepRuns(doc, 'guard', ['GH_TOKEN']));
});

test('a step missing entirely is reported', () => {
  const doc = release();
  doc.jobs['verify-image'].steps = [doc.jobs['verify-image'].steps[0]];
  isRed(checkStepRuns(doc, 'verify-image', VERIFY_IMAGE_SNIPPETS), 'assert-image.sh');
});

// --- checkCiGates ------------------------------------------------------------

test('a missing ci gate token is reported', () => {
  const doc = ci();
  doc.jobs.static.steps = doc.jobs.static.steps.filter(
    (step) => !String(step.run ?? '').includes('check:app'),
  );
  isRed(checkCiGates(doc), 'check:app');
});

test('a gate token that is only a substring is still found', () => {
  // `validate:workflows:ci` must satisfy the `validate:workflows` token.
  isGreen(checkCiGates(ci()));
});

test('a shell docker build in ci is rejected', () => {
  const doc = ci();
  doc.jobs.static.steps.push({ run: 'docker build -t local .' });
  isRed(checkCiGates(doc), 'docker build');
});

// --- checkDispatch -----------------------------------------------------------

test('an extra trigger is rejected', () => {
  const doc = release();
  doc.on.push = { branches: ['main'] };
  isRed(checkDispatch(doc), 'workflow_dispatch');
});

test('resume_from_verify defaulting to true is rejected', () => {
  const doc = release();
  doc.on.workflow_dispatch.inputs.resume_from_verify.default = true;
  isRed(checkDispatch(doc), 'resume_from_verify');
});

test('resume_from_verify typed as string is rejected', () => {
  const doc = release();
  doc.on.workflow_dispatch.inputs.resume_from_verify.type = 'string';
  isRed(checkDispatch(doc), 'resume_from_verify');
});

test('a missing confirm_version input is rejected', () => {
  const doc = release();
  delete doc.on.workflow_dispatch.inputs.confirm_version;
  isRed(checkDispatch(doc), 'confirm_version');
});

// --- checkResumePath -- a resume path must not become a universal pass -------

test('a verify-image condition that only guards against skipped is rejected', () => {
  const doc = release();
  doc.jobs['verify-image'].if = "${{ needs.publish.result != 'skipped' }}";
  isRed(checkResumePath(doc), '!= \'skipped\'');
});

test('a publish job that is not gated on resume_from_verify is rejected', () => {
  const doc = release();
  doc.jobs.publish.if = '${{ true }}';
  isRed(checkResumePath(doc), 'resume_from_verify');
});

test('a verify-image job that drops the static dependency is rejected', () => {
  const doc = release();
  doc.jobs['verify-image'].needs = ['publish'];
  isRed(checkResumePath(doc), 'static');
});

// --- checkTagGate -- a skipped publish must not silently skip the tag ---------

test('a tag job with no explicit condition is rejected', () => {
  const doc = release();
  delete doc.jobs.tag.if;
  isRed(checkTagGate(doc), 'always()');
});

test('a tag condition that only requires the guard is rejected', () => {
  const doc = release();
  doc.jobs.tag.if = "${{ always() && needs.guard.result == 'success' }}";
  isRed(checkTagGate(doc), 'verify-image.result');
});

test('a tag condition phrased as != skipped is rejected', () => {
  const doc = release();
  doc.jobs.tag.if = "${{ always() && needs.verify-image.result != 'skipped' && needs.guard.result == 'success' }}";
  isRed(checkTagGate(doc), "!= 'skipped'");
});

test('a missing tag job is reported instead of silently passing', () => {
  const doc = release();
  delete doc.jobs.tag;
  isRed(checkTagGate(doc), 'missing');
});

// --- checkJobsHaveCheckout ---------------------------------------------------

test('a job whose first step is not checkout is rejected', () => {
  const doc = ci();
  doc.jobs.static.steps.reverse();
  isRed(checkJobsHaveCheckout(doc), 'checkout');
});

test('a tag job without fetch-depth: 0 cannot see the tag being created', () => {
  const doc = release();
  doc.jobs.tag.steps[0].with = { 'fetch-depth': 1 };
  isRed(checkJobsHaveCheckout(doc), 'fetch-depth');
});

test('a tag job missing the with block entirely is rejected', () => {
  const doc = release();
  delete doc.jobs.tag.steps[0].with;
  isRed(checkJobsHaveCheckout(doc), 'fetch-depth');
});

// --- validateWorkflows / main ------------------------------------------------

test('validateWorkflows fails closed when the files are absent', () => {
  withWorkflows({}, (dir) => {
    const result = validateWorkflows({ profile: 'all', cwd: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.detail.includes('missing workflow file')));
  });
});

test('validateWorkflows is green and reports its rule count for both files', () => {
  withWorkflows({ 'ci.yml': CI_YAML, 'release.yml': RELEASE_YAML }, (dir) => {
    const result = validateWorkflows({ profile: 'all', cwd: dir });
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.ok(result.rules >= 18, `expected at least 18 rules, got ${result.rules}`);
  });
});

test('validateWorkflows reports invalid YAML as a problem, not a crash', () => {
  withWorkflows({ 'ci.yml': 'on: [unclosed', 'release.yml': RELEASE_YAML }, (dir) => {
    const result = validateWorkflows({ profile: 'ci', cwd: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.length > 0);
  });
});

test('parseArgs reads both --profile forms', () => {
  assert.equal(parseArgs(['--profile', 'ci']).profile, 'ci');
  assert.equal(parseArgs(['--profile=release']).profile, 'release');
});

test('parseArgs rejects an unknown profile and an unknown flag', () => {
  assert.throws(() => parseArgs(['--profile', 'nope']), /must be one of/i);
  assert.throws(() => parseArgs(['--bogus']), /unknown/i);
});

test('main returns 0 for valid files, 1 for missing files, 2 for a bad flag', () => {
  withWorkflows({ 'ci.yml': CI_YAML, 'release.yml': RELEASE_YAML }, (dir) => {
    assert.equal(main(['--profile', 'all'], dir), 0);
  });
  withWorkflows({}, (dir) => {
    assert.equal(main(['--profile', 'all'], dir), 1);
  });
  assert.equal(main(['--profile', 'nope'], process.cwd()), 2);
});
