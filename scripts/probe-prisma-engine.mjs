#!/usr/bin/env node
// Prisma engine-shape probe (plan 02-02, threat T-02-02).
//
// Why this file exists: the Docker image is built for linux/amd64 AND
// linux/arm64. Historically Prisma shipped a native query engine binary chosen
// by `binaryTargets`; generating on an amd64 host and shipping an arm64 image
// produced a green build and a container that crashed on the first query
// (docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md:134).
//
// That risk is only real if the generated client still contains a native
// binary. This probe answers that question from the artifacts on disk -- never
// from `prisma --version` banners, which describe the CLI, not the client.
//
// Contract with the rest of the pipeline:
//   apps/api/prisma/ENGINE_DECISION  contains exactly `NATIVE_ENGINE` or `RUST_FREE`
//   this script                       re-derives the truth and fails on mismatch
//
// Zero dependencies: only `node:` builtins.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_ENGINE = 'NATIVE_ENGINE';
export const RUST_FREE = 'RUST_FREE';

/** File-name prefixes/extensions that prove a native Prisma engine is present. */
const NATIVE_MARKERS = [
  (name) => name.endsWith('.node'),
  (name) => name.startsWith('libquery_engine'),
  (name) => name.startsWith('query_engine-'),
  (name) => name.startsWith('query-engine'),
];

/**
 * Directory the generator writes into.
 *
 * `output` in the schema is relative to the schema file, NOT to the repo root
 * and NOT to the package directory. Resolving it against the wrong base is the
 * bug that made an earlier run report a false `RUST_FREE`: the probe looked at
 * a directory that never existed, found no binaries there, and "passed".
 *
 * Returns null when the schema has no explicit `output` (legacy
 * `node_modules/.prisma/client` layout) or when the file cannot be read.
 */
export function readGeneratorOutput(schemaPath) {
  let text;
  try {
    text = readFileSync(schemaPath, 'utf8');
  } catch {
    return null;
  }
  const match = /output\s*=\s*"([^"]+)"/.exec(text);
  if (match === null) return null;
  return path.resolve(path.dirname(schemaPath), match[1]);
}

/**
 * Every plausible generated-client location, most specific first. The caller
 * takes the first one that exists, so a stale legacy directory cannot mask a
 * live one.
 */
export function candidateDirs({ root = process.cwd(), schemaPath } = {}) {
  const schema = schemaPath ?? path.join(root, 'apps/api/prisma/schema.prisma');
  const fromSchema = readGeneratorOutput(schema);
  const dirs = [];
  if (fromSchema !== null) dirs.push(fromSchema);
  dirs.push(path.join(root, 'apps/api/node_modules/.prisma/client'));
  dirs.push(path.join(root, 'node_modules/.prisma/client'));
  return dirs;
}

export function findClientDir(options = {}) {
  for (const dir of candidateDirs(options)) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/** All files under `dir`, recursively, as absolute paths. */
export function listFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) found.push(absolute);
    }
  };
  walk(dir);
  return found;
}

export function isNativeEngineFile(filePath) {
  const name = path.basename(filePath);
  return NATIVE_MARKERS.some((matches) => matches(name));
}

/**
 * Derives the decision from artifacts on disk.
 * Returns `{ decision, dir, nativeFiles, fileCount }`; `decision` is null when
 * no generated client directory could be found at all (which must never be
 * reported as RUST_FREE -- "nothing there" is not evidence of "no engine").
 */
export function probe({ root = process.cwd(), schemaPath } = {}) {
  const dir = findClientDir({ root, schemaPath });
  if (dir === null) {
    return { decision: null, dir: null, nativeFiles: [], fileCount: 0 };
  }

  const files = listFiles(dir);
  const nativeFiles = files.filter(isNativeEngineFile);

  return {
    decision: nativeFiles.length > 0 ? NATIVE_ENGINE : RUST_FREE,
    dir,
    nativeFiles: nativeFiles.map((file) => path.relative(dir, file).split(path.sep).join('/')),
    fileCount: files.length,
  };
}

/**
 * Removes `//` line comments and `/* ... *​/` block comments so prose in the
 * schema cannot be mistaken for configuration. The schema is a config file, not
 * a place where `binaryTargets` could legitimately appear inside a string, so a
 * plain strip is safe here.
 */
export function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').replace(/\s+$/, ''))
    .join('\n');
}

export function readDecisionFile(decisionPath) {
  try {
    return readFileSync(decisionPath, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Compares the recorded decision with the probe result and with the schema.
 * Returns `{ ok, reason }` so both the CLI and the tests share one rule set.
 */
export function checkDecision({ root = process.cwd(), schemaPath, decisionPath } = {}) {
  const schema = schemaPath ?? path.join(root, 'apps/api/prisma/schema.prisma');
  const decisionFile = decisionPath ?? path.join(root, 'apps/api/prisma/ENGINE_DECISION');

  const result = probe({ root, schemaPath: schema });
  if (result.decision === null) {
    return { ok: false, reason: 'generated client dir not found; run prisma generate first', probe: result };
  }

  const recorded = readDecisionFile(decisionFile);
  if (recorded === null) {
    return { ok: false, reason: `ENGINE_DECISION missing at ${decisionFile}`, probe: result };
  }
  if (recorded !== NATIVE_ENGINE && recorded !== RUST_FREE) {
    return { ok: false, reason: `invalid ENGINE_DECISION: ${JSON.stringify(recorded)}`, probe: result };
  }
  if (recorded !== result.decision) {
    return { ok: false, reason: `ENGINE_DECISION mismatch: file=${recorded} probe=${result.decision}`, probe: result };
  }

  // A RUST_FREE client must not carry dead configuration: a leftover
  // `binaryTargets` would tell the next reader (and plan 02-03) that native
  // engines are still in play.
  if (recorded === RUST_FREE) {
    const schemaText = stripComments(readFileSync(schema, 'utf8'));
    if (/binaryTargets/.test(schemaText)) {
      return { ok: false, reason: 'RUST_FREE but schema.prisma still declares binaryTargets', probe: result };
    }
  }

  return { ok: true, reason: `ok: ${recorded}`, probe: result };
}

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) return process.cwd();
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('--root requires a directory argument');
  }
  return path.resolve(value);
}

const isCliEntry = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntry) {
  const result = checkDecision({ root: parseRoot(process.argv) });
  const probed = result.probe;
  if (probed.dir !== null) {
    console.log(`client dir: ${probed.dir}`);
    console.log(`files scanned: ${probed.fileCount}`);
    console.log(`native binaries: ${probed.nativeFiles.length}`);
    for (const file of probed.nativeFiles) console.log(`  NATIVE: ${file}`);
    // Timestamp of the freshest artifact: proves the directory was generated
    // now and is not a leftover from a previous generator setting.
    const newest = listFiles(probed.dir)
      .map((file) => statSync(file).mtimeMs)
      .reduce((max, value) => (value > max ? value : max), 0);
    console.log(`newest artifact mtime: ${new Date(newest).toISOString()}`);
  }
  console.log(result.reason);
  if (!result.ok) process.exitCode = 1;
}
