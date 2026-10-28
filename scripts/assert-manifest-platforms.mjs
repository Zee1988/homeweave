#!/usr/bin/env node
/**
 * HomeWeave manifest assertions -- the "verify-image" half of the release chain.
 *
 * Two independent promises are checked here, both of them things that look green
 * in CI while being wrong in production:
 *
 *   1. The published image index really carries BOTH architectures (IMG-04).
 *      A single-arch build still serves `docker pull` happily on the matching
 *      machine, so nothing fails until a Raspberry Pi user (aarch64) tries to
 *      update and gets "no matching manifest".
 *   2. The image tag is exactly the version declared in `homeweave_app/config.yaml`
 *      (T-02-07): the Supervisor builds `<image>:<version>` from that file, so a
 *      tag/version drift turns every update into a 404 with no local symptom.
 *
 * WHY `provenance`/`sbom` MATTER HERE (research §4.4):
 * `docker/build-push-action` v6+ defaults to `provenance: mode=min`, which appends
 * an attestation manifest with platform `unknown/unknown` to the index. The index
 * then holds three manifests instead of two, so an "exactly two platforms" check
 * must (a) fail on `unknown/unknown` rather than silently filtering it out, and
 * (b) be paired with `provenance: false` / `sbom: false` in the workflow, which
 * `scripts/validate-workflows.mjs` asserts structurally.
 *
 * The pure functions take parsed JSON, so the whole matrix is testable without
 * Docker; only `main` shells out, and it also accepts `--file <json>` so a
 * recorded index can be replayed locally.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The only platform pair HomeWeave ships. Supervisor's arch list is broader. */
export const EXPECTED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

const USAGE = 'usage: node scripts/assert-manifest-platforms.mjs <image-ref> <config-version> [--file <manifest.json>]';

function firstLine(text) {
  return String(text).split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}

/**
 * Canonical `os/architecture` identifier for one index entry.
 *
 * `variant` is deliberately ignored: registries report `linux/arm64` and
 * `linux/arm64/v8` interchangeably for the same target, so including it would
 * fail on a correct build. A descriptor with no platform at all (an attestation
 * manifest) becomes `unknown/unknown`, which is never in the expected set --
 * that is how the provenance flag surfaces here.
 *
 * @param {{os?: string, architecture?: string}|undefined|null} platform
 * @returns {string}
 */
export function platformId(platform) {
  if (platform === null || typeof platform !== 'object') return 'unknown/unknown';
  const os = typeof platform.os === 'string' && platform.os !== '' ? platform.os : 'unknown';
  const arch =
    typeof platform.architecture === 'string' && platform.architecture !== ''
      ? platform.architecture
      : 'unknown';
  return `${os}/${arch}`;
}

/**
 * Asserts the index platform SET equals `expected` exactly.
 *
 * @param {object|string} manifestJson parsed index, or its raw JSON text
 * @param {string[]} [expected]
 * @returns {{ok: boolean, expected: string[], platforms: string[], problems: string[]}}
 */
export function assertPlatforms(manifestJson, expected = EXPECTED_PLATFORMS) {
  const wanted = [...new Set(expected)].sort();
  const problems = [];

  const asFailure = (problem) => ({ ok: false, expected: wanted, platforms: [], problems: [problem] });

  let doc = manifestJson;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch (error) {
      return asFailure(`manifest is not valid JSON (${firstLine(error.message)})`);
    }
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return asFailure(`manifest must be a JSON object, got ${describe(doc)}`);
  }

  if (!Array.isArray(doc.manifests)) {
    // A single-platform image has no `manifests[]` at all: it is an image
    // manifest, not an index. Nothing here can prove arm64 exists.
    return asFailure(
      'not a manifest index: no manifests[] array, so a second architecture cannot be proven to exist',
    );
  }

  if (doc.manifests.length === 0) {
    return asFailure('manifest index is empty (0 manifests), so neither architecture is actually published');
  }

  const perEntry = doc.manifests.map((entry) => platformId(entry === null ? null : entry.platform));
  const platforms = [...new Set(perEntry)].sort();

  const missing = wanted.filter((id) => !platforms.includes(id));
  const extra = platforms.filter((id) => !wanted.includes(id));

  if (missing.length > 0) {
    problems.push(
      `missing platform(s) ${missing.join(', ')}: expected exactly [${wanted.join(', ')}], got [${platforms.join(', ')}]`,
    );
  }

  if (extra.length > 0) {
    problems.push(
      `unexpected platform(s) ${extra.join(', ')}: expected exactly [${wanted.join(', ')}], got [${platforms.join(', ')}]`,
    );
  }

  if (extra.includes('unknown/unknown')) {
    problems.push(
      'unknown/unknown comes from provenance/sbom attestation manifests appended by docker/build-push-action; publish must set provenance: false and sbom: false',
    );
  }

  // Set equality alone would hide a duplicated architecture: two linux/amd64
  // entries still form the set {linux/amd64, linux/arm64} once arm64 is there.
  const duplicated = wanted.filter((id) => perEntry.filter((entry) => entry === id).length > 1);
  if (duplicated.length > 0) {
    problems.push(
      `platform(s) appear more than once: ${duplicated.join(', ')} -- the index must hold exactly one manifest per architecture`,
    );
  }

  return { ok: problems.length === 0, expected: wanted, platforms, problems };
}

/**
 * Asserts the image tag is byte-identical to the declared config version and
 * carries no `v` prefix (`v0.1.0` and `0.1.0` are different git tags and
 * different image tags; only one of them matches what Supervisor builds).
 *
 * @param {string} tag
 * @param {string} configVersion
 * @returns {{ok: boolean, tag: string, version: string, problems: string[]}}
 */
export function assertVersionMatch(tag, configVersion) {
  const actualTag = typeof tag === 'string' ? tag : '';
  const actualVersion = typeof configVersion === 'string' ? configVersion : '';
  const problems = [];

  if (actualTag === '') {
    problems.push('image reference carries no tag, so it cannot be matched against config.yaml "version"');
  }

  if (actualVersion === '') {
    problems.push('expected config.yaml "version" is empty, so nothing can be matched against the image tag');
  }

  if (actualTag !== '' && /^[vV]/.test(actualTag)) {
    problems.push(`image tag "${actualTag}" must not carry a "v" prefix; config.yaml declares "${actualVersion}"`);
  }

  if (actualTag !== '' && actualVersion !== '' && actualTag !== actualVersion) {
    problems.push(
      `image tag "${actualTag}" does not equal config.yaml "version" "${actualVersion}"; Supervisor builds <image>:<version> from that file, so this tag would 404 on every update`,
    );
  }

  return { ok: problems.length === 0, tag: actualTag, version: actualVersion, problems };
}

/**
 * Extracts the tag from an image reference, ignoring any registry port and any
 * `@sha256:` digest. Returns '' when the reference is untagged.
 *
 * @param {string} ref
 * @returns {string}
 */
export function tagOfRef(ref) {
  const withoutDigest = String(ref ?? '').split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastSegment = withoutDigest.slice(lastSlash + 1);
  const colon = lastSegment.lastIndexOf(':');
  if (colon === -1) return '';
  return lastSegment.slice(colon + 1);
}

/**
 * Parses CLI arguments. Throws on anything unexpected so a typo cannot silently
 * skip the version assertion.
 *
 * @param {string[]} argv
 * @returns {{ref: string, version: string, file: string|null}}
 */
export function parseArgs(argv = []) {
  const positional = [];
  let file = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token.startsWith('--file=')) {
      const value = token === '--file' ? argv[index + 1] : token.slice('--file='.length);
      if (value === undefined || value === '') throw new Error('--file requires a path to a manifest JSON file');
      file = value;
      if (token === '--file') index += 1;
      continue;
    }
    if (token.startsWith('--')) throw new Error(`unknown option "${token}"`);
    positional.push(token);
  }

  if (positional.length !== 2) {
    throw new Error(`expected exactly two arguments (<image-ref> <config-version>), got ${positional.length}`);
  }

  return { ref: positional[0], version: positional[1], file };
}

/** Runs `docker manifest inspect <ref>` and returns its raw JSON output. */
function inspectManifest(ref) {
  const result = spawnSync('docker', ['manifest', 'inspect', ref], { encoding: 'utf8' });
  if (result.error) {
    return { ok: false, output: `cannot run docker: ${result.error.message}`, raw: '' };
  }
  const status = typeof result.status === 'number' ? result.status : 1;
  if (status !== 0) {
    return { ok: false, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, raw: '' };
  }
  return { ok: true, output: '', raw: result.stdout ?? '' };
}

/**
 * CLI body: prints every problem as `✗ <detail>` and returns the exit code.
 *
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv = []) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.log(`✗ ${error.message}`);
    console.log(USAGE);
    return 2;
  }

  let raw;
  if (args.file !== null) {
    try {
      raw = readFileSync(args.file, 'utf8');
    } catch (error) {
      console.log(`✗ cannot read --file "${args.file}" (${error.code || error.message})`);
      return 1;
    }
  } else {
    const inspected = inspectManifest(args.ref);
    if (!inspected.ok) {
      console.log(`✗ docker manifest inspect failed for ${args.ref}`);
      const detail = String(inspected.output).trim();
      if (detail !== '') {
        for (const line of detail.split(/\r?\n/)) console.log(`    ${line}`);
      }
      return 1;
    }
    raw = inspected.raw;
  }

  const platformResult = assertPlatforms(raw);
  const versionResult = assertVersionMatch(tagOfRef(args.ref), args.version);

  const problems = [
    ...platformResult.problems.map((problem) => `platforms: ${problem}`),
    ...versionResult.problems.map((problem) => `version: ${problem}`),
  ];

  if (problems.length > 0) {
    for (const problem of problems) console.log(`✗ ${problem}`);
    return 1;
  }

  console.log(
    `✓ manifest matches: platforms [${platformResult.platforms.join(', ')}], tag ${versionResult.tag} == config version ${versionResult.version}`,
  );
  return 0;
}

const isCliEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntry) {
  process.exitCode = main(process.argv.slice(2));
}
