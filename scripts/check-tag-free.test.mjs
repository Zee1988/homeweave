import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyPackageState,
  classifyTagState,
  decideOutcome,
  packageEndpoints,
  parseArgs,
  parseImageRef,
} from './check-tag-free.mjs';

/**
 * These cases operate on fixed strings only. Nothing here shells out to docker
 * or gh: the point is that the classification matrix can be proven on a machine
 * that has neither, which is every developer machine in this phase.
 */

const REF = 'ghcr.io/zee1988/homeweave-ha-app:0.1.0';

function probes(...entries) {
  return entries.map(([exitCode, output]) => ({ exitCode, output }));
}

// ---------------------------------------------------------------------------
// classifyTagState -- four states, and the order they are tested in
// ---------------------------------------------------------------------------

test('classifyTagState: exit 0 means the tag exists, whatever the output says', () => {
  assert.equal(classifyTagState({ exitCode: 0, output: '{"schemaVersion":2}' }), 'exists');
  // A successful inspect whose body happens to contain "not found" in a label
  // must still be `exists`: the exit code is the proof, not the text.
  assert.equal(classifyTagState({ exitCode: 0, output: 'annotation: not found' }), 'exists');
});

test('classifyTagState: every not-found wording counts as free', () => {
  const wordings = [
    'no such manifest: ghcr.io/zee1988/homeweave-ha-app:0.1.0',
    'manifest unknown',
    'Error response from daemon: manifest for ghcr.io/zee1988/homeweave-ha-app:0.1.0 not found',
    'unexpected status from GET request: 404 Not Found',
  ];
  for (const output of wordings) {
    assert.equal(classifyTagState({ exitCode: 1, output }), 'free', `expected free for: ${output}`);
  }
});

test('classifyTagState: authentication wordings are auth-error', () => {
  const wordings = [
    'unauthorized',
    'unauthorized: authentication required',
    'denied: requested access to the resource is denied',
    'unexpected status from GET request: 403 Forbidden',
    'insufficient_scope: missing packages:read',
  ];
  for (const output of wordings) {
    assert.equal(classifyTagState({ exitCode: 1, output }), 'auth-error', `expected auth-error for: ${output}`);
  }
});

test('classifyTagState: auth is decided BEFORE not-found -- "unauthorized ... 404" is NOT free', () => {
  // This is threat T-02-05 in one line. GHCR answers a private package with an
  // auth refusal whose body can still mention 404; classifying not-found first
  // would read a permission failure as a free tag and allow an overwrite.
  const ghcrPrivatePackage = [
    'Error response from daemon: Head "https://ghcr.io/v2/zee1988/homeweave-ha-app/manifests/0.1.0":',
    'unauthorized: authentication required',
    'unexpected status from GET request: 404 Not Found',
  ].join('\n');
  assert.equal(classifyTagState({ exitCode: 1, output: ghcrPrivatePackage }), 'auth-error');
});

test('classifyTagState: everything unrecognised is unknown-error (never free)', () => {
  const wordings = [
    '',
    undefined,
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    'Get "https://ghcr.io/v2/": net/http: TLS handshake timeout',
    'manifest list bytes read failure',
  ];
  for (const output of wordings) {
    assert.equal(classifyTagState({ exitCode: 1, output }), 'unknown-error', `expected unknown-error for: ${output}`);
  }
  // A null exit code (process killed) is not "exists" either.
  assert.equal(classifyTagState({ exitCode: null, output: '' }), 'unknown-error');
  assert.equal(classifyTagState({}), 'unknown-error');
});

// ---------------------------------------------------------------------------
// classifyPackageState -- three states over TWO endpoints
// ---------------------------------------------------------------------------

test('classifyPackageState: a probe that returned a package body means present', () => {
  const body = '{"id":123456,"name":"homeweave-ha-app","visibility":"private"}';
  // Either endpoint is enough: a package may be linked to the repo on one and
  // only reachable through the user endpoint on the other.
  assert.equal(classifyPackageState({ probes: probes([0, body], [1, 'gh: Not Found (HTTP 404)']) }), 'present');
  assert.equal(classifyPackageState({ probes: probes([1, 'gh: Not Found (HTTP 404)'], [0, body]) }), 'present');
  assert.equal(classifyPackageState({ probes: probes([0, body], [0, body]) }), 'present');
});

test('classifyPackageState: an exit 0 body without "id" is not proof of a package', () => {
  assert.equal(classifyPackageState({ probes: probes([0, '[]'], [0, '[]']) }), 'unknown');
});

test('classifyPackageState: both probes 404 means the package has never been published', () => {
  const notFound = 'gh: Not Found (HTTP 404)';
  assert.equal(classifyPackageState({ probes: probes([1, notFound], [1, notFound]) }), 'absent');
});

test('classifyPackageState: one 404 plus one auth failure is unknown, NOT absent', () => {
  // The single-endpoint trap: only one endpoint answering 404 must never be
  // read as "the package does not exist", or a merely invisible package would
  // waive the auth error and allow an overwrite.
  assert.equal(
    classifyPackageState({
      probes: probes([1, 'gh: Not Found (HTTP 404)'], [1, 'gh: Resource not accessible by integration (HTTP 403)']),
    }),
    'unknown',
  );
  assert.equal(
    classifyPackageState({ probes: probes([1, 'gh: Not Found (HTTP 404)'], [1, 'dial tcp: i/o timeout']) }),
    'unknown',
  );
});

test('classifyPackageState: unauthenticated gh (empty output) is unknown', () => {
  // Without GH_TOKEN, `gh api` refuses locally and prints nothing on stdout.
  // That is neither a package nor a 404, so the waiver cannot fire.
  assert.equal(
    classifyPackageState({
      probes: probes([1, ''], [1, 'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.']),
    }),
    'unknown',
  );
  assert.equal(classifyPackageState({ probes: [] }), 'unknown');
  assert.equal(classifyPackageState({}), 'unknown');
});

// ---------------------------------------------------------------------------
// decideOutcome -- the flag matrix
// ---------------------------------------------------------------------------

test('decideOutcome: a free tag satisfies --expect free (the default release run)', () => {
  const outcome = decideOutcome({ tagState: 'free', expected: 'free', ref: REF });
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.lines.join('\n'), /tag is free/);
});

test('decideOutcome: an existing tag fails --expect free with the bump instruction', () => {
  const outcome = decideOutcome({ tagState: 'exists', expected: 'free', ref: REF });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.lines.join('\n'), /✗ tag already exists in GHCR; bump config\.yaml version/);
});

test('decideOutcome: an existing tag satisfies --expect exists (the resume path)', () => {
  const outcome = decideOutcome({ tagState: 'exists', expected: 'exists', ref: REF });
  assert.equal(outcome.exitCode, 0);
});

test('decideOutcome: a free tag fails --expect exists (resuming without an image is meaningless)', () => {
  const outcome = decideOutcome({ tagState: 'free', expected: 'exists', ref: REF });
  assert.equal(outcome.exitCode, 1);
});

test('decideOutcome: auth-error WITHOUT the flag exits 1', () => {
  const outcome = decideOutcome({
    tagState: 'auth-error',
    expected: 'free',
    allowMissingPackage: false,
    packageState: 'absent',
    ref: REF,
    rawOutput: 'unauthorized: authentication required',
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.lines.join('\n'), /authentication reason/);
});

test('decideOutcome: auth-error WITH the flag and an absent package is waived', () => {
  const outcome = decideOutcome({
    tagState: 'auth-error',
    expected: 'free',
    allowMissingPackage: true,
    packageState: 'absent',
    ref: REF,
  });
  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(outcome.lines, ['::warning::package has never been published; treating tag as free']);
});

test('decideOutcome: auth-error WITH the flag but a PRESENT package still exits 1', () => {
  // A real permission failure, not a first publish. This is the line that keeps
  // the waiver from becoming a general-purpose "ignore auth errors" switch.
  const outcome = decideOutcome({
    tagState: 'auth-error',
    expected: 'free',
    allowMissingPackage: true,
    packageState: 'present',
    ref: REF,
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.lines.join('\n'), /real permission failure/);
});

test('decideOutcome: auth-error WITH the flag but an UNKNOWN package state exits 1', () => {
  const outcome = decideOutcome({
    tagState: 'auth-error',
    expected: 'free',
    allowMissingPackage: true,
    packageState: 'unknown',
    ref: REF,
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.lines.join('\n'), /never waived on a guess/);
});

test('decideOutcome: auth-error WITH the flag but no probe result at all exits 1', () => {
  const outcome = decideOutcome({
    tagState: 'auth-error',
    expected: 'free',
    allowMissingPackage: true,
    packageState: null,
    ref: REF,
  });
  assert.equal(outcome.exitCode, 1);
});

test('decideOutcome: --expect exists is never satisfied by the missing-package waiver', () => {
  const outcome = decideOutcome({
    tagState: 'auth-error',
    expected: 'exists',
    allowMissingPackage: true,
    packageState: 'absent',
    ref: REF,
  });
  assert.equal(outcome.exitCode, 1);
});

test('decideOutcome: unknown-error is never waived by the flag', () => {
  for (const allowMissingPackage of [false, true]) {
    const outcome = decideOutcome({
      tagState: 'unknown-error',
      expected: 'free',
      allowMissingPackage,
      packageState: 'absent',
      ref: REF,
      rawOutput: 'net/http: TLS handshake timeout',
    });
    assert.equal(outcome.exitCode, 1, `unknown-error must fail with allowMissingPackage=${allowMissingPackage}`);
    assert.match(outcome.lines.join('\n'), /NON-not-found reason/);
  }
});

// ---------------------------------------------------------------------------
// reference parsing and argument parsing
// ---------------------------------------------------------------------------

test('parseImageRef: splits a ghcr reference into registry/owner/package', () => {
  assert.deepEqual(parseImageRef(REF), {
    registry: 'ghcr.io',
    owner: 'zee1988',
    pkg: 'homeweave-ha-app',
    repo: 'zee1988/homeweave-ha-app',
  });
  // A digest reference must not leak into the package name.
  assert.equal(parseImageRef('ghcr.io/zee1988/homeweave-ha-app@sha256:abc').pkg, 'homeweave-ha-app');
});

test('parseImageRef: rejects a bare package name', () => {
  assert.throws(() => parseImageRef('homeweave-ha-app:0.1.0'), /must look like/);
  assert.throws(() => parseImageRef(''), /must look like/);
});

test('packageEndpoints: probes BOTH the repo and the user endpoint', () => {
  assert.deepEqual(packageEndpoints({ owner: 'zee1988', pkg: 'homeweave-ha-app' }), [
    '/repos/zee1988/homeweave-ha-app/packages/container/homeweave-ha-app',
    '/users/zee1988/packages/container/homeweave-ha-app',
  ]);
});

test('parseArgs: the default expectation is free', () => {
  assert.deepEqual(parseArgs([REF]), { ref: REF, expect: 'free', allowMissingPackage: false });
});

test('parseArgs: reads --expect and --allow-missing-package in any order', () => {
  assert.deepEqual(parseArgs([REF, '--expect', 'exists']), {
    ref: REF,
    expect: 'exists',
    allowMissingPackage: false,
  });
  assert.deepEqual(parseArgs(['--expect=exists', REF]), {
    ref: REF,
    expect: 'exists',
    allowMissingPackage: false,
  });
  assert.deepEqual(parseArgs(['--allow-missing-package', REF, '--expect', 'free']), {
    ref: REF,
    expect: 'free',
    allowMissingPackage: true,
  });
});

test('parseArgs: rejects a bogus expectation, an unknown option and the wrong arity', () => {
  assert.throws(() => parseArgs([REF, '--expect', 'notexists']), /--expect must be one of/);
  assert.throws(() => parseArgs([REF, '--expect']), /requires a value/);
  assert.throws(() => parseArgs([REF, '--yolo']), /unknown option/);
  assert.throws(() => parseArgs([]), /exactly one image reference/);
  assert.throws(() => parseArgs([REF, 'ghcr.io/zee1988/other:1.0.0']), /exactly one image reference/);
});
