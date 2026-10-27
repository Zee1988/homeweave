/**
 * HomeWeave app metadata validator.
 *
 * Field list source: the official Apps configuration reference at
 * https://contributors.home-assistant.io/apps/reference/configuration/
 * and the repository guide at https://contributors.home-assistant.io/apps/guides/repository/.
 * That list is maintained by hand in this file and MUST be re-checked against the official
 * pages whenever upstream changes them -- keeping it current is the upkeep cost we accepted
 * when we chose a dependency-free local validator over the official addon-linter container.
 *
 * Contract:
 *   - Entry point is `pnpm validate:app` (Phase 2 CI calls exactly this, no refactor later).
 *   - Failures are collected in an array and reported together at the end. There is no
 *     fail-fast path: every independent check runs, so one run lists every problem at once.
 *   - Exit codes are only 0 (all checks passed) and 1 (at least one check failed).
 *   - Assertions are made on js-yaml parsed values, never on YAML source formatting.
 *     Single and double quotes are semantically equivalent, so quote style is not checked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();

const CONFIG_FILE = 'homeweave_app/config.yaml';
const REPOSITORY_FILE = 'repository.yaml';
const CONFIG_PATH = join(ROOT, 'homeweave_app', 'config.yaml');
const REPOSITORY_PATH = join(ROOT, 'repository.yaml');

const CONFIG_REQUIRED_KEYS = ['name', 'slug', 'version', 'description', 'arch'];

const failures = [];
let checksRun = 0;

function fail(code, file, message) {
  failures.push({ code, file, message });
}

function pass() {
  checksRun += 1;
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function readAndParse(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    fail('V1', label, `cannot be read (${error.code || error.message})`);
    return null;
  }

  let data;
  try {
    data = yaml.load(text);
  } catch (error) {
    const reason = String(error.message).split('\n')[0];
    fail('V1', label, `is not valid YAML (${reason})`);
    return null;
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    fail('V1', label, `top level must be a mapping, got ${describe(data)}`);
    return null;
  }

  pass();
  return data;
}

const config = readAndParse(CONFIG_PATH, CONFIG_FILE);
const repository = readAndParse(REPOSITORY_PATH, REPOSITORY_FILE);

// V2: the five required keys must be present in the app configuration.
if (config) {
  for (const key of CONFIG_REQUIRED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      pass();
    } else {
      fail('V2', CONFIG_FILE, `missing required key "${key}"`);
    }
  }
}

// V3: the repository manifest must carry a usable name.
if (repository) {
  const name = repository.name;
  if (typeof name === 'string' && name.trim() !== '') {
    pass();
  } else {
    fail('V3', REPOSITORY_FILE, `"name" must be a non-empty string, got ${describe(name)}`);
  }
}

for (const failure of failures) {
  console.log(`✗ ${failure.code} ${failure.file}: ${failure.message}`);
}

if (failures.length === 0) {
  console.log(`✓ ${checksRun} checks passed`);
} else {
  console.log(`${checksRun} checks run, ${failures.length} failed`);
  process.exitCode = 1;
}
