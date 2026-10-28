import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_PLATFORMS,
  assertPlatforms,
  assertVersionMatch,
  parseArgs,
  platformId,
  tagOfRef,
} from './assert-manifest-platforms.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assert-manifest-platforms.mjs');
const REF = 'ghcr.io/zee1988/homeweave-ha-app:0.1.0';

/** Builds an OCI image index with one entry per given platform. */
function index(platforms) {
  return { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: platforms.map((platform, position) => ({ digest: `sha256:${String(position).padStart(4, '0')}`, platform })) };
}

const AMD64 = { os: 'linux', architecture: 'amd64' };
const ARM64 = { os: 'linux', architecture: 'arm64' };

/** The exact shape `build-push-action` produces when provenance stays enabled. */
const ATTESTATION = { os: 'unknown', architecture: 'unknown' };

function problemsOf(result) {
  return result.problems.join('\n');
}

// ---------------------------------------------------------------------------
// assertPlatforms
// ---------------------------------------------------------------------------

test('assertPlatforms: the two-architecture index passes', () => {
  const result = assertPlatforms(index([AMD64, ARM64]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.platforms, ['linux/amd64', 'linux/arm64']);
  assert.deepEqual(result.expected, [...EXPECTED_PLATFORMS].sort());
});

test('assertPlatforms: a raw JSON string is accepted (that is what docker prints)', () => {
  assert.equal(assertPlatforms(JSON.stringify(index([ARM64, AMD64]))).ok, true);
});

test('assertPlatforms: arm64 variant metadata does not fail the exact-set rule', () => {
  // Registries report the same target as linux/arm64 or linux/arm64/v8; only the
  // os/architecture pair is contractual, so the variant must not be compared.
  const result = assertPlatforms(index([AMD64, { os: 'linux', architecture: 'arm64', variant: 'v8' }]));
  assert.equal(result.ok, true);
});

test('assertPlatforms: the provenance index (unknown/unknown) fails and names the real set', () => {
  const result = assertPlatforms(index([AMD64, ARM64, ATTESTATION]));
  assert.equal(result.ok, false);
  const text = problemsOf(result);
  assert.match(text, /unknown\/unknown/);
  assert.match(text, /got \[linux\/amd64, linux\/arm64, unknown\/unknown\]/);
  assert.match(text, /provenance: false and sbom: false/);
});

test('assertPlatforms: a single-architecture index fails', () => {
  const result = assertPlatforms(index([AMD64]));
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /missing platform\(s\) linux\/arm64/);
  assert.match(problemsOf(result), /got \[linux\/amd64\]/);
});

test('assertPlatforms: an arm64-only index fails for the other direction', () => {
  const result = assertPlatforms(index([ARM64]));
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /missing platform\(s\) linux\/amd64/);
});

test('assertPlatforms: an empty manifests array fails', () => {
  const result = assertPlatforms({ schemaVersion: 2, manifests: [] });
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /index is empty/);
});

test('assertPlatforms: a plain image manifest (no manifests[]) fails', () => {
  const result = assertPlatforms({ schemaVersion: 2, config: { digest: 'sha256:abc' }, layers: [] });
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /not a manifest index/);
});

test('assertPlatforms: a duplicate architecture fails instead of collapsing into a set', () => {
  const result = assertPlatforms(index([AMD64, AMD64, ARM64]));
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /appear more than once: linux\/amd64/);
});

test('assertPlatforms: non-JSON input and non-object input fail with a reason', () => {
  assert.match(problemsOf(assertPlatforms('not json at all')), /not valid JSON/);
  assert.match(problemsOf(assertPlatforms('[1,2,3]')), /must be a JSON object, got a list/);
  assert.match(problemsOf(assertPlatforms(null)), /must be a JSON object, got null/);
});

test('platformId: a descriptor without a platform is unknown/unknown', () => {
  assert.equal(platformId(undefined), 'unknown/unknown');
  assert.equal(platformId(null), 'unknown/unknown');
  assert.equal(platformId({}), 'unknown/unknown');
  assert.equal(platformId({ os: 'linux' }), 'linux/unknown');
});

// ---------------------------------------------------------------------------
// assertVersionMatch
// ---------------------------------------------------------------------------

test('assertVersionMatch: identical tag and version pass', () => {
  const result = assertVersionMatch('0.1.0', '0.1.0');
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test('assertVersionMatch: a "v" prefix fails even when the rest matches', () => {
  const result = assertVersionMatch('v0.1.0', '0.1.0');
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /must not carry a "v" prefix/);
});

test('assertVersionMatch: a drifted version fails', () => {
  const result = assertVersionMatch('0.1.1', '0.1.0');
  assert.equal(result.ok, false);
  assert.match(problemsOf(result), /does not equal config\.yaml "version" "0\.1\.0"/);
});

test('assertVersionMatch: a missing tag or an empty version fails', () => {
  assert.match(problemsOf(assertVersionMatch('', '0.1.0')), /carries no tag/);
  assert.match(problemsOf(assertVersionMatch('0.1.0', '')), /is empty/);
  assert.match(problemsOf(assertVersionMatch(undefined, undefined)), /carries no tag/);
});

// ---------------------------------------------------------------------------
// reference / argument parsing
// ---------------------------------------------------------------------------

test('tagOfRef: extracts the tag and ignores registry ports and digests', () => {
  assert.equal(tagOfRef(REF), '0.1.0');
  assert.equal(tagOfRef('ghcr.io:443/zee1988/homeweave-ha-app:0.1.0'), '0.1.0');
  assert.equal(tagOfRef('ghcr.io/zee1988/homeweave-ha-app'), '');
  // A digest is not a tag: the digest is stripped and '' means "untagged", which
  // assertVersionMatch reports as a failure rather than silently accepting it.
  assert.equal(tagOfRef('ghcr.io/zee1988/homeweave-ha-app@sha256:deadbeef'), '');
});

test('parseArgs: two positionals, optional --file, real errors otherwise', () => {
  assert.deepEqual(parseArgs([REF, '0.1.0']), { ref: REF, version: '0.1.0', file: null });
  assert.deepEqual(parseArgs([REF, '0.1.0', '--file', 'index.json']), {
    ref: REF,
    version: '0.1.0',
    file: 'index.json',
  });
  assert.deepEqual(parseArgs(['--file=index.json', REF, '0.1.0']), {
    ref: REF,
    version: '0.1.0',
    file: 'index.json',
  });
  assert.throws(() => parseArgs([REF]), /exactly two arguments/);
  assert.throws(() => parseArgs([REF, '0.1.0', '--nope']), /unknown option/);
  assert.throws(() => parseArgs([REF, '0.1.0', '--file']), /requires a path/);
});

// ---------------------------------------------------------------------------
// CLI end-to-end through --file (no Docker needed)
// ---------------------------------------------------------------------------

test('CLI --file: a correct index for the declared version exits 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-manifest-'));
  try {
    const file = path.join(dir, 'index.json');
    writeFileSync(file, JSON.stringify(index([AMD64, ARM64])), 'utf8');
    const result = spawnSync(process.execPath, [SCRIPT, REF, '0.1.0', '--file', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /✓ manifest matches: platforms \[linux\/amd64, linux\/arm64\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --file: a provenance index exits 1 and prints the actual platform set', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-manifest-'));
  try {
    const file = path.join(dir, 'index.json');
    writeFileSync(file, JSON.stringify(index([AMD64, ARM64, ATTESTATION])), 'utf8');
    const result = spawnSync(process.execPath, [SCRIPT, REF, '0.1.0', '--file', file], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /✗ platforms: unexpected platform\(s\) unknown\/unknown/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --file: a version mismatch exits 1 even when the platforms are right', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-manifest-'));
  try {
    const file = path.join(dir, 'index.json');
    writeFileSync(file, JSON.stringify(index([AMD64, ARM64])), 'utf8');
    const result = spawnSync(process.execPath, [SCRIPT, 'ghcr.io/zee1988/homeweave-ha-app:v0.1.0', '0.1.0', '--file', file], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /✗ version: image tag "v0\.1\.0" must not carry a "v" prefix/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --file: an unreadable fixture exits 1 with a reason', () => {
  const result = spawnSync(process.execPath, [SCRIPT, REF, '0.1.0', '--file', path.join(tmpdir(), 'no-such-index-xyz.json')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗ cannot read --file/);
});
