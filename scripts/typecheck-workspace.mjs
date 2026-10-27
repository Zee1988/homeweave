#!/usr/bin/env node
// Workspace typecheck entry (VER-01).
//
// Forwards to `pnpm -r --if-present typecheck` so every workspace package that
// declares the script is really compiled -- no fake green, no "close enough".
//
// The one rule this script exists for: when no package declares `typecheck`,
// printing success would be a lie. So that case prints
// `✗ no workspace package declares typecheck` and exits 1.
//
// Only `node:` builtins and the already-present `js-yaml` are used.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// Kept in step with CI (`pnpm/action-setup@v4`, see 02-04). Root package.json
// must not carry a `packageManager` field, so the version is pinned here.
const PNPM_VERSION = '9.15.4';

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Directories matching the `packages:` patterns of pnpm-workspace.yaml.
 * Only the `prefix/*` form is supported: that is all this repo uses, and
 * supporting more would mean hand-rolling a glob matcher.
 */
export function collectWorkspaceDirs(root) {
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) return [];

  const parsed = yaml.load(readFileSync(workspaceFile, 'utf8'));
  const patterns = Array.isArray(parsed?.packages) ? parsed.packages : [];

  const dirs = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.endsWith('/*')) continue;
    const parentDir = path.join(root, pattern.slice(0, -2));
    if (!existsSync(parentDir)) continue;

    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      dirs.push(path.join(parentDir, entry.name));
    }
  }

  return dirs;
}

/** Workspace packages that declare a non-empty `scripts.typecheck`. */
export function collectTypecheckPackages(root) {
  const packages = [];

  for (const dir of collectWorkspaceDirs(root)) {
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = readJsonFile(manifestPath);
    const script = manifest?.scripts?.typecheck;
    if (typeof script !== 'string' || script.trim().length === 0) continue;

    packages.push({
      name: typeof manifest.name === 'string' ? manifest.name : path.basename(dir),
      dir: path.relative(root, dir).split(path.sep).join('/'),
      script,
    });
  }

  return packages;
}

/**
 * Runs the recursive typecheck. Returns the child's exit code so the CLI can
 * forward it unchanged.
 *
 * When invoked through `pnpm run typecheck`, `npm_execpath` points at pnpm's JS
 * entry and `node <execpath>` is used: portable, and no dependency on a global
 * `pnpm` shim (which plain `pnpm` calls inside scripts cannot assume).
 */
export function runTypecheck({ root = process.cwd(), write = () => {}, stdio = 'inherit' } = {}) {
  const packages = collectTypecheckPackages(root);

  if (packages.length === 0) {
    write('✗ no workspace package declares typecheck');
    return { ok: false, code: 1, packages };
  }

  const execpath = process.env.npm_execpath;
  const pnpmEntry = typeof execpath === 'string' && /pnpm/i.test(path.basename(execpath))
    ? execpath
    : null;

  try {
    if (pnpmEntry !== null) {
      execFileSync(process.execPath, [pnpmEntry, '-r', '--if-present', 'typecheck'], {
        cwd: root,
        stdio,
        env: process.env,
      });
    } else {
      execSync(`corepack pnpm@${PNPM_VERSION} -r --if-present typecheck`, {
        cwd: root,
        stdio,
        env: process.env,
        shell: true,
      });
    }
  } catch (error) {
    const code = typeof error?.status === 'number' && error.status !== 0 ? error.status : 1;
    write(`✗ typecheck failed (exit ${code})`);
    return { ok: false, code, packages };
  }

  write(`✓ typecheck passed (${packages.map((entry) => entry.name).join(', ')})`);
  return { ok: true, code: 0, packages };
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
  const result = runTypecheck({ root: parseRoot(process.argv), write: (line) => console.log(line) });
  if (!result.ok) process.exitCode = result.code;
}
