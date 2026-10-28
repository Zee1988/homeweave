#!/usr/bin/env node
/**
 * HomeWeave tag-existence gate -- the fail-closed half of "先镜像、后版本号".
 *
 * Threat T-02-05 (Tampering, high): `docker manifest inspect` exits 1 for BOTH
 * "the tag does not exist" and "you are not allowed to see it". Treating any
 * non-zero exit as "tag free" therefore lets a release silently overwrite an
 * already published image. This module never does that.
 *
 * Rules encoded here -- do not relax them, they ARE the mitigation:
 *
 *   1. `exitCode === 0` is the only proof a tag exists: the registry returned a
 *      manifest, so no text matching is involved.
 *   2. AUTHENTICATION is classified BEFORE "not found". GHCR answers a private
 *      package with `unauthorized ... 404`, so a "not found" check that runs
 *      first reads a permission problem as a free tag -- exactly the bug this
 *      file exists to prevent. See AUTH_MARKERS / NOT_FOUND_TAG_MARKERS below.
 *   3. Anything unrecognised is `unknown-error` and exits 1. There is no
 *      "assume free" branch: a network hiccup must stop the release, not open it.
 *   4. `--allow-missing-package` covers ONE situation: the very first publish,
 *      when the GHCR *package* does not exist yet, so every inspect is refused
 *      with an auth error and no tag can be observed at all. The waiver needs
 *      BOTH package endpoints to answer 404 (see classifyPackageState: a single
 *      endpoint can 404 for a package that exists but is merely invisible to the
 *      caller, which would turn "I cannot see it" into "it is not there"). If the
 *      package exists (`present`) or cannot be established (`unknown`), the auth
 *      error stands and the gate stays red.
 *   5. `--expect exists` is the resume path: after a visibility fix the image
 *      must really be in GHCR, so nothing is waived there.
 *
 * Tests feed fixed strings into the pure functions and never shell out to
 * docker or gh: `pnpm test` must stay runnable on a machine without Docker.
 * The registry wording actually observed for a *missing tag* is UNVERIFIED on
 * this machine (no Docker). If CI shows a wording that is not listed here, add
 * it under "free" only after reading the real message -- the fallback for an
 * unknown message is fail-closed, never "non-zero means free".
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Registry/client wordings that mean "this tag is genuinely absent".
 * Matched case-insensitively against stdout+stderr of `docker manifest inspect`.
 */
const NOT_FOUND_TAG_MARKERS = ['manifest unknown', 'no such manifest', 'not found', '404'];

/**
 * Wordings that mean "you may not look". Checked BEFORE NOT_FOUND_TAG_MARKERS:
 * `unauthorized: authentication required ... 404` must be an auth problem.
 */
const AUTH_MARKERS = ['unauthorized', 'denied', '403', 'authentication required', 'insufficient_scope'];

/**
 * What the two `gh api` package endpoints print when the package is really not
 * there (`gh: Not Found (HTTP 404)`). Anything else -- an unauthenticated gh
 * printing nothing on stdout, a 403, a transport error -- is NOT a 404.
 */
const NOT_FOUND_PACKAGE_MARKERS = ['http 404', 'not found', '404'];

/** Accepted values for `--expect`. `free` is the default (a normal release run). */
export const EXPECTATIONS = ['exists', 'free'];

const USAGE =
  'usage: node scripts/check-tag-free.mjs <image-ref> [--expect exists|free] [--allow-missing-package]';

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function containsAny(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

/**
 * Classifies one `docker manifest inspect` result.
 *
 * @param {{exitCode?: number|null, output?: string|Buffer}} probe
 * @returns {'exists'|'free'|'auth-error'|'unknown-error'}
 */
export function classifyTagState({ exitCode, output } = {}) {
  // Rule 1: a returned manifest is the only positive proof.
  if (exitCode === 0) return 'exists';

  const text = lower(output);

  // Rule 2: auth before not-found. Reversing these two lines reintroduces T-02-05.
  if (containsAny(text, AUTH_MARKERS)) return 'auth-error';

  // Rule 3 (positive half): only a recognisable not-found wording counts as free.
  if (containsAny(text, NOT_FOUND_TAG_MARKERS)) return 'free';

  // Rule 3 (negative half): everything else is refused.
  return 'unknown-error';
}

/**
 * Classifies the GHCR *package* itself from the two `gh api` probes.
 *
 * Used ONLY to decide "the package has never been published". It must never be
 * used to decide whether a specific tag exists: `/packages/container/<pkg>/versions`
 * answers 200 for a package that exists even when the requested tag does not,
 * which makes it a far more subtle trap than the auth misread (research §4.3).
 *
 * @param {{probes?: Array<{exitCode?: number|null, output?: string|Buffer}>}} input
 * @returns {'absent'|'present'|'unknown'}
 */
export function classifyPackageState({ probes = [] } = {}) {
  if (!Array.isArray(probes) || probes.length === 0) return 'unknown';

  // `present` if ANY endpoint returned a package body. A private package may be
  // 404 on one endpoint and visible on the other, so one hit is enough.
  const present = probes.some(
    (probe) => probe !== null && typeof probe === 'object' && probe.exitCode === 0 && lower(probe.output).includes('"id"'),
  );
  if (present) return 'present';

  // `absent` requires EVERY endpoint to answer a real 404. One 404 plus one
  // auth/transport failure stays `unknown`, so the waiver cannot fire.
  const allNotFound = probes.every(
    (probe) =>
      probe !== null &&
      typeof probe === 'object' &&
      probe.exitCode !== 0 &&
      containsAny(lower(probe.output), NOT_FOUND_PACKAGE_MARKERS),
  );
  if (allNotFound) return 'absent';

  return 'unknown';
}

/**
 * Splits `ghcr.io/<owner>/<package>:<tag>` into the parts `gh api` needs.
 *
 * @param {string} ref
 * @returns {{registry: string, owner: string, pkg: string, repo: string}}
 */
export function parseImageRef(ref) {
  const withoutDigest = String(ref ?? '').split('@')[0];
  const segments = withoutDigest.split('/');
  if (segments.length < 3) {
    throw new Error(
      `image reference "${ref}" must look like <registry>/<owner>/<package>[:<tag>] (got ${segments.length} segment(s))`,
    );
  }

  const registry = segments[0];
  const rest = segments.slice(1);
  const owner = rest[0];
  const pkg = rest[rest.length - 1].split(':')[0];

  if (registry === '' || owner === '' || pkg === '') {
    throw new Error(`image reference "${ref}" has an empty registry, owner or package component`);
  }

  return { registry, owner, pkg, repo: `${owner}/${pkg}` };
}

/**
 * The two package endpoints, both of which must agree before the waiver fires.
 *
 * `/repos/...` covers a package linked to the repository; `/users/...` covers one
 * that is not linked yet (the usual state right after the first push). A single
 * endpoint 404s for a package that exists but is invisible, so both are needed.
 */
export function packageEndpoints({ owner, pkg }) {
  return [
    `/repos/${owner}/${pkg}/packages/container/${pkg}`,
    `/users/${owner}/packages/container/${pkg}`,
  ];
}

function indent(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Pure decision step: the whole flag matrix in one place, so the CLI body stays
 * a thin shell over injectable probes.
 *
 * @param {{
 *   tagState: 'exists'|'free'|'auth-error'|'unknown-error',
 *   expected?: 'exists'|'free',
 *   allowMissingPackage?: boolean,
 *   packageState?: 'absent'|'present'|'unknown'|null,
 *   ref?: string,
 *   rawOutput?: string,
 * }} input
 * @returns {{exitCode: number, lines: string[]}}
 */
export function decideOutcome({
  tagState,
  expected = 'free',
  allowMissingPackage = false,
  packageState = null,
  ref = '',
  rawOutput = '',
}) {
  const lines = [];

  const pass = (message) => {
    lines.push(message);
    return { exitCode: 0, lines };
  };

  const refuse = (message) => {
    lines.push(`✗ ${message}`);
    if (String(rawOutput).trim() !== '') lines.push(indent(rawOutput));
    return { exitCode: 1, lines };
  };

  if (tagState === 'exists') {
    if (expected === 'exists') return pass(`✓ tag exists in GHCR: ${ref}`);
    return refuse('tag already exists in GHCR; bump config.yaml version');
  }

  if (tagState === 'free') {
    if (expected === 'free') return pass(`✓ tag is free: ${ref}`);
    return refuse(`expected the tag to exist in GHCR but the registry reports it is absent: ${ref}`);
  }

  if (tagState === 'auth-error') {
    if (allowMissingPackage) {
      if (packageState === 'present') {
        return refuse(
          'the GHCR package exists, so this authentication error is a real permission failure, not a first publish -- --allow-missing-package does not apply',
        );
      }
      if (packageState === 'unknown') {
        return refuse(
          'the GHCR package state could not be established (the probes returned neither the package nor two clean 404s) -- an authentication error is never waived on a guess',
        );
      }
      if (packageState === 'absent') {
        if (expected !== 'free') {
          return refuse(
            'the GHCR package has never been published, so this image tag cannot exist either -- --expect exists cannot be satisfied',
          );
        }
        return pass('::warning::package has never been published; treating tag as free');
      }
      return refuse(
        'the GHCR package state was not probed -- --allow-missing-package requires both package probes to answer 404 before it waives an authentication error',
      );
    }

    return refuse(
      '`docker manifest inspect` failed for an authentication reason, not because the tag is missing -- a 403/missing credential is never read as "tag free"',
    );
  }

  // unknown-error: the flag is irrelevant here by design.
  return refuse(
    '`docker manifest inspect` failed for a NON-not-found reason (network/registry/tooling) -- a non-zero exit is never read as "tag free"',
  );
}

/**
 * Parses CLI arguments. Throws on anything unexpected so a typo cannot silently
 * fall back to the default expectation.
 *
 * @param {string[]} argv
 * @returns {{ref: string, expect: 'exists'|'free', allowMissingPackage: boolean}}
 */
export function parseArgs(argv = []) {
  const parsed = { ref: null, expect: 'free', allowMissingPackage: false };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--allow-missing-package') {
      parsed.allowMissingPackage = true;
      continue;
    }

    if (token === '--expect' || token.startsWith('--expect=')) {
      const value = token === '--expect' ? argv[index + 1] : token.slice('--expect='.length);
      if (value === undefined || value === '') {
        throw new Error(`--expect requires a value (${EXPECTATIONS.join('|')})`);
      }
      if (!EXPECTATIONS.includes(value)) {
        throw new Error(`--expect must be one of ${EXPECTATIONS.join('|')}, got "${value}"`);
      }
      parsed.expect = value;
      if (token === '--expect') index += 1;
      continue;
    }

    if (token.startsWith('--')) throw new Error(`unknown option "${token}"`);
    positional.push(token);
  }

  if (positional.length !== 1) {
    throw new Error(`expected exactly one image reference, got ${positional.length}`);
  }

  parsed.ref = positional[0];
  return parsed;
}

/** Runs `docker manifest inspect <ref>` and normalises the result shape. */
function inspectTag(ref) {
  const result = spawnSync('docker', ['manifest', 'inspect', ref], { encoding: 'utf8' });
  if (result.error) {
    return { exitCode: 127, output: `cannot run docker: ${result.error.message}` };
  }
  const status = typeof result.status === 'number' ? result.status : 1;
  return { exitCode: status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Runs one `gh api <endpoint>` package probe. */
function probePackageEndpoint(endpoint) {
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8' });
  if (result.error) {
    return { exitCode: 127, output: `cannot run gh: ${result.error.message}` };
  }
  const status = typeof result.status === 'number' ? result.status : 1;
  return { exitCode: status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * CLI body. Returns the exit code instead of setting it, so a test could drive
 * it directly; the `docker`/`gh` calls are the only non-pure part.
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

  const probe = inspectTag(args.ref);
  const tagState = classifyTagState(probe);

  // The package probes run only when they could possibly matter: they need
  // `gh` credentials, and running them unconditionally would turn a clean
  // "tag free" run into an unrelated gh failure.
  let packageState = null;
  if (tagState === 'auth-error' && args.allowMissingPackage) {
    let endpoints;
    try {
      endpoints = packageEndpoints(parseImageRef(args.ref));
    } catch (error) {
      console.log(`✗ ${error.message}`);
      console.log(USAGE);
      return 2;
    }
    packageState = classifyPackageState({
      probes: endpoints.map((endpoint) => probePackageEndpoint(endpoint)),
    });
  }

  const outcome = decideOutcome({
    tagState,
    expected: args.expect,
    allowMissingPackage: args.allowMissingPackage,
    packageState,
    ref: args.ref,
    rawOutput: probe.output,
  });

  for (const line of outcome.lines) console.log(line);
  return outcome.exitCode;
}

const isCliEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntry) {
  process.exitCode = main(process.argv.slice(2));
}
