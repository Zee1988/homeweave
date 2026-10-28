#!/usr/bin/env node
// Single, fail-fast entry point for the production image build (IMG-05, plan 02-03).
//
// Why a script instead of a bare `docker buildx build` in package.json:
//   1. this host has no Docker at all, so the command must say *why* it failed
//      instead of surfacing `'docker' is not recognized as an internal or external
//      command` from PowerShell;
//   2. the image tag carries the App version, and that version has exactly one
//      source of truth — the App manifest Supervisor reads
//      (`homeweave_app/config.yaml`). A second copy in a package manifest would
//      drift silently and ship an image whose tag disagrees with the App metadata
//      (plan 02-03 Task 3, rule 3).
//
// Exit codes: 0 = build succeeded, 1 = build failed or a precondition was not met.
// There is no "skipped" outcome: a build that verified nothing must not look green.
//
// Zero third-party dependencies: config.yaml's `version` is a top-level scalar, so
// a line-level match is enough and pulling in a YAML parser for one key would add a
// dependency that also has to be shipped to CI.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_MANIFEST = 'homeweave_app/config.yaml';
const IMAGE_TAG = 'homeweave-ha-app:local';
const PLATFORM = 'linux/amd64';
const DOCKERFILE = 'Dockerfile';

// The exact wording is asserted by plan 02-03 Task 3: the message must contain
// `image builds are CI-only` so CI logs and docs can point at the same sentence.
// `docs/23` does not exist in this repository; the image/HAOS deployment notes live
// in docs/21, so that is what the message points at.
export const DOCKER_MISSING_MESSAGE =
  '✗ docker is not available on this machine; image builds are CI-only (see docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md)';

function firstLine(text) {
  return String(text).split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
}

/**
 * Reads the App version from the App manifest text.
 * Returns null when there is no top-level `version:` scalar, so the caller can fail
 * closed rather than tag an image `undefined`.
 */
export function readAppVersion(manifestText) {
  const match = /^version:[ \t]*["']?([^"'\r\n#]*?)["']?[ \t]*(?:#.*)?$/m.exec(manifestText);
  if (match === null) return null;
  const value = match[1].trim();
  return value.length === 0 ? null : value;
}

/** Probes `docker buildx version`; a missing CLI and a missing plugin both count as unavailable. */
export function probeBuildx({ spawn = spawnSync } = {}) {
  const result = spawn('docker', ['buildx', 'version'], { encoding: 'utf8' });
  const detail = firstLine(result.stderr ?? result.error?.message ?? '');
  return { available: result.status === 0 && !result.error, detail };
}

export function buildArgs(version) {
  return [
    'buildx',
    'build',
    '--platform',
    PLATFORM,
    '--load',
    '-f',
    DOCKERFILE,
    '-t',
    IMAGE_TAG,
    '--label',
    `org.opencontainers.image.version=${version}`,
    '.',
  ];
}

const isCliEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntry) {
  const buildx = probeBuildx();
  if (!buildx.available) {
    console.error(DOCKER_MISSING_MESSAGE);
    if (buildx.detail.length > 0) console.error(`  reason: ${buildx.detail}`);
    process.exit(1);
  }

  let version = null;
  try {
    version = readAppVersion(readFileSync(path.join(REPO_ROOT, APP_MANIFEST), 'utf8'));
  } catch (error) {
    console.error(`✗ cannot read ${APP_MANIFEST}: ${firstLine(error.message)}`);
    process.exit(1);
  }
  if (version === null) {
    console.error(`✗ ${APP_MANIFEST} has no top-level \`version\` scalar; refusing to tag an image without a version`);
    process.exit(1);
  }

  console.log(`building ${IMAGE_TAG} for ${PLATFORM} (app version ${version})`);
  console.log(`  context: ${REPO_ROOT}`);

  const result = spawnSync('docker', buildArgs(version), { stdio: 'inherit', cwd: REPO_ROOT });
  if (result.error !== undefined && result.error !== null) {
    console.error(`✗ failed to invoke docker: ${firstLine(result.error.message)}`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}
