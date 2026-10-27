#!/usr/bin/env node
// Zero-dependency workspace lint (VER-01).
//
// Checks, per file:
//   *.mjs          -> real syntax check through `node --check` (same parser as runtime)
//   *.yaml / *.yml -> must be parseable by js-yaml
//   *.json         -> must be parseable by JSON.parse
//
// Any problem prints `✗ <file>: <reason>` and makes the process exit non-zero.
// Only `node:` builtins and the already-present `js-yaml` are used.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.planning',
  '.expo',
  'coverage',
]);

const CHECKED_EXTENSIONS = new Set(['.mjs', '.yaml', '.yml', '.json']);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

export function collectFiles(root) {
  const collected = [];

  function walk(absoluteDir, relativeDir) {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(absoluteDir, entry.name), path.join(relativeDir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!CHECKED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      collected.push(path.join(relativeDir, entry.name));
    }
  }

  walk(root, '');
  return collected.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function firstLine(text) {
  return String(text).split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
}

function syntaxError(root, relativePath) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, relativePath)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    return null;
  } catch (error) {
    const detail = firstLine(error.stderr ?? error.message ?? '');
    return detail.length > 0 ? detail : 'node --check failed';
  }
}

function jsonError(root, relativePath) {
  const text = readFileSync(path.join(root, relativePath), 'utf8');
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const detail = firstLine(error.message);
    const position = /position (\d+)/.exec(error.message);
    if (position === null) return detail;
    const line = text.slice(0, Number(position[1])).split('\n').length;
    return `line ${line}: ${detail}`;
  }
}

function yamlError(root, relativePath) {
  try {
    yaml.load(readFileSync(path.join(root, relativePath), 'utf8'));
    return null;
  } catch (error) {
    const line = error?.mark?.line;
    const detail = firstLine(error?.reason ?? error?.message ?? 'invalid YAML');
    return typeof line === 'number' ? `line ${line + 1}: ${detail}` : detail;
  }
}

/** Returns the problem description for one file, or null when the file is fine. */
export function lintFile(root, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.mjs') return syntaxError(root, relativePath);
  if (extension === '.json') return jsonError(root, relativePath);
  if (extension === '.yaml' || extension === '.yml') return yamlError(root, relativePath);
  return null;
}

export function runLint({ root = process.cwd(), write = () => {} } = {}) {
  const files = collectFiles(root);
  const problems = [];

  for (const relativePath of files) {
    const problem = lintFile(root, relativePath);
    if (problem !== null) problems.push({ file: toPosix(relativePath), reason: problem });
  }

  for (const { file, reason } of problems) {
    write(`✗ ${file}: ${reason}`);
  }

  if (problems.length > 0) {
    write(`✗ lint failed (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
    return { ok: false, files, problems };
  }

  write(`✓ lint passed (${files.length} files)`);
  return { ok: true, files, problems };
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
  const result = runLint({ root: parseRoot(process.argv), write: (line) => console.log(line) });
  if (!result.ok) process.exitCode = 1;
}
