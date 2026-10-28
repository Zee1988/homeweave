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

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_ENGINE = 'NATIVE_ENGINE';
export const RUST_FREE = 'RUST_FREE';

/**
 * What `RUST_FREE` actually covers, and the value printed for it.
 *
 * The name was always a statement about the *Prisma query engine*: the client uses
 * the WASM query compiler, so no `libquery_engine-*.node` is generated and the
 * amd64/arm64 binary-target mismatch that used to kill the arm64 image cannot occur.
 *
 * It was read as a statement about the *whole runtime* -- "this image contains no
 * platform-specific binaries". That was already false the moment the SQLite driver
 * adapter pulled in `better-sqlite3`, which ships `prebuilds/linux-*.node`. Keeping
 * the literal `RUST_FREE` (plan 02-03's assert-image.sh and Dockerfile comments
 * consume it) while printing this scope line is the fix: the conclusion stays, the
 * overclaim goes. The other dimension is reported by NATIVE_MODULES below.
 */
export const RUST_FREE_SCOPE = 'prisma-engine-only';

/**
 * The native modules this runtime is allowed to contain.
 *
 * Same idea as APP_SOURCE_KEYS in generate-app-metadata.mjs: an explicit,
 * hand-maintained list plus a two-way assertion. A `.node` file outside this list
 * means someone added a native dependency without deciding it belongs in the image;
 * a listed module that is missing means the install did not do what the lockfile
 * says. Both are reported, neither is silently tolerated.
 *
 * `better-sqlite3` is the only legal entry: Prisma 7's SQLite story runs the query
 * planner through this addon. It is not a Prisma query engine, which is exactly why
 * it does not belong in the ENGINE_DECISION dimension.
 */
export const NATIVE_MODULE_MANIFEST = ['better-sqlite3'];

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

// ---------------------------------------------------------------------------------------
// Second scan surface: installed native modules (D-05a).
//
// Deliberately a separate walker from listFiles(). listFiles() enumerates a generated
// client directory, which is small and known; node_modules is neither, and it needs two
// things listFiles() does not do:
//
//   1. follow symlinks -- pnpm's layout is almost entirely symlinks into .pnpm/, so a
//      walker that skips a Dirent with isDirectory() === false sees no packages at all
//      and reports a triumphant "no native modules" for an image full of them;
//   2. de-duplicate by real path -- the same binary is reachable as
//      node_modules/better-sqlite3/... and as
//      node_modules/.pnpm/better-sqlite3@13.x/node_modules/better-sqlite3/...; without
//      realpath de-duplication the same module is counted (and listed) twice.
//
// Scanned roots stay limited to node_modules, never the repository: this is a build-time
// fact about the installed dependency tree, not a source-tree lint.
// ---------------------------------------------------------------------------------------

/** realpath, tolerating a broken link instead of throwing mid-walk. */
function realpathOrSelf(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

/** The installed dependency root, or null when the repository has no install. */
export function findNodeModulesDir({ root = process.cwd() } = {}) {
  const dir = path.join(root, 'node_modules');
  return existsSync(dir) ? dir : null;
}

/**
 * Every `.node` file reachable from `nodeModulesDir`, as absolute real paths, sorted.
 *
 * A fixed visit budget bounds the walk. It exists because this runs against a real
 * `node_modules` in CI and an unbounded recursive walk of a dependency tree is one
 * symlink cycle away from never returning. Exhausting the budget is reported by the
 * caller as an incomplete scan rather than as "nothing found" -- the same distinction
 * probe() draws between "no client dir" and "no engine in the client dir".
 */
export function findNativeModuleFiles(nodeModulesDir, { maxVisits = 50000 } = {}) {
  const files = [];
  if (nodeModulesDir === null) return files;

  const visitedDirs = new Set();
  const seenFiles = new Set();
  const pending = [nodeModulesDir];
  let visits = 0;

  while (pending.length > 0 && visits < maxVisits) {
    const current = pending.pop();
    visits += 1;

    const realCurrent = realpathOrSelf(current);
    if (visitedDirs.has(realCurrent)) continue;
    visitedDirs.add(realCurrent);

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      // An unreadable directory (permissions, a racing install) is skipped rather than
      // aborting the walk: one unreadable dependency must not hide every other one.
      continue;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(absolute);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue; // dangling link
        }
      }

      if (isDirectory) {
        pending.push(absolute);
        continue;
      }
      if (!isFile || !entry.name.endsWith('.node')) continue;

      const realFile = realpathOrSelf(absolute);
      if (seenFiles.has(realFile)) continue;
      seenFiles.add(realFile);
      files.push(realFile);
    }
  }

  return files.sort();
}

/**
 * Name of the package that owns `filePath`, by walking up to the nearest package.json.
 *
 * Package name is read from the manifest rather than parsed out of the path on purpose:
 * the path shape differs between a flat install, a pnpm store install
 * (`.pnpm/<pkg>@<version>/node_modules/<pkg>/...`) and scoped packages
 * (`@scope/name`), while `name` in package.json is the same string in all three. The
 * walk stops at `nodeModulesDir` so a stray `.node` sitting directly in node_modules
 * cannot inherit the repository's own package name.
 */
export function resolveModuleName(filePath, nodeModulesDir) {
  const boundary = realpathOrSelf(nodeModulesDir);
  let current = path.dirname(filePath);

  while (path.resolve(current) !== path.resolve(boundary)) {
    const manifestPath = path.join(current, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (typeof manifest.name === 'string' && manifest.name !== '') return manifest.name;
      } catch {
        // A malformed manifest is not a reason to lose the finding: fall through to the
        // path-derived name below so the module is still named in the report.
      }
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const relativeParts = path.relative(boundary, filePath).split(path.sep);
  // Skip the `.pnpm/<pkg>@<version>/node_modules` prefix when present.
  const marker = relativeParts.lastIndexOf('node_modules');
  const afterStore = marker === -1 ? relativeParts : relativeParts.slice(marker + 1);
  return afterStore.length > 1 ? afterStore[0] : null;
}

/**
 * Scans the installed tree for native modules.
 *
 * Returns `{ scanned, nodeModulesDir, modules, files, complete }`.
 *
 * `scanned: false` means there was no `node_modules` to look at -- the state of a bare
 * clone. That is reported explicitly instead of being folded into an empty `modules`
 * list, because "I did not look" and "I looked and found nothing" are different facts
 * and only the second one is a green result. This mirrors probe()'s refusal to report
 * RUST_FREE when the generated client directory is missing.
 */
export function scanNativeModules({ root = process.cwd(), maxVisits } = {}) {
  const nodeModulesDir = findNodeModulesDir({ root });
  if (nodeModulesDir === null) {
    return { scanned: false, complete: false, nodeModulesDir: null, modules: [], files: [] };
  }

  const files = findNativeModuleFiles(nodeModulesDir, maxVisits === undefined ? {} : { maxVisits });
  const names = new Set();
  for (const file of files) {
    const name = resolveModuleName(file, nodeModulesDir);
    if (name !== null) names.add(name);
  }

  return {
    scanned: true,
    complete: true,
    nodeModulesDir,
    modules: [...names].sort(),
    files,
  };
}

/**
 * Two-way assertion of the native module manifest, shaped like assertConsumedKeys().
 *
 * Unexpected module present -> fail (an undecided native dependency is in the image).
 * No `node_modules` at all    -> fail (cannot verify; "unknown" is not "clean").
 *
 * A manifest entry that is merely absent is NOT a failure: a repository that has not
 * been installed yet, or a partial install, legitimately lacks `better-sqlite3`, and the
 * image-side check in plan 02-03's assert-image.sh is what proves it is really there.
 */
export function checkNativeModuleManifest({
  root = process.cwd(),
  manifest = NATIVE_MODULE_MANIFEST,
} = {}) {
  const scan = scanNativeModules({ root });

  if (!scan.scanned) {
    return {
      ok: false,
      reason: 'node_modules not found; the native module manifest cannot be verified (run the install first)',
      unexpected: [],
      ...scan,
    };
  }

  const unexpected = scan.modules.filter((name) => !manifest.includes(name));
  if (unexpected.length > 0) {
    return {
      ok: false,
      reason: `native module(s) outside the manifest: ${unexpected.join(', ')} (expected only: ${manifest.join(', ')})`,
      unexpected,
      ...scan,
    };
  }

  const listed = scan.modules.length > 0 ? scan.modules.join(', ') : '(none)';
  return { ok: true, reason: `ok: native modules: ${listed}`, unexpected: [], ...scan };
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
  const root = parseRoot(process.argv);

  // --- Dimension 1: the Prisma query engine (unchanged contract). ---------------------
  const result = checkDecision({ root });
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
  // Both of these lines were already here and are consumed elsewhere (plan 02-03 reads
  // ENGINE_DECISION; probe-prisma-engine.test.mjs asserts the `ok: <value>` wording).
  // They are printed verbatim, before any of the new output, so no consumer ordering
  // assumption can be broken by the extension below.
  if (probed.decision !== null) console.log(`ENGINE_DECISION=${probed.decision}`);
  console.log(result.reason);

  // --- Dimension 2: installed native modules (D-05a). --------------------------------
  // Printed unconditionally: a consumer must be able to tell "scanned, none found" from
  // "never scanned", and only an always-present line can express that.
  const manifest = checkNativeModuleManifest({ root });
  console.log(`NATIVE_MODULES=${manifest.modules.join(',')}`);
  console.log(`NATIVE_MODULES_SCANNED=${manifest.scanned ? 'true' : 'false'}`);
  console.log(`RUST_FREE_SCOPE=${RUST_FREE_SCOPE}`);
  for (const file of manifest.files) {
    console.log(`  NATIVE_MODULE_FILE: ${path.relative(root, file).split(path.sep).join('/')}`);
  }

  // Exit codes: dimension 1 keeps its original rule. Dimension 2 fails the run only when
  // it actually found something it cannot account for; a missing node_modules is reported
  // (scanned=false) but is not a failure of *this* script, because the probe is also run
  // on a bare checkout where no install exists -- the image-side gate in assert-image.sh
  // is where "the module must be present" is enforced.
  if (!result.ok) process.exitCode = 1;
  if (manifest.scanned && manifest.unexpected.length > 0) {
    console.error(manifest.reason);
    process.exitCode = 1;
  }
}
