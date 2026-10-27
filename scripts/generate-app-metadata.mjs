// Generate HomeWeave App metadata artifacts from a single source of truth.
//
// Source: homeweave_app/app-metadata.json
// Output: repository.yaml (repository root) and homeweave_app/config.yaml
//
// Implementation note (deliberate design decision, see 01-PATTERNS.md section 2):
// this script builds the YAML line by line as strings instead of using
// `js-yaml`'s `dump()`. `dump()` cannot emit comments, so a pure dump would
// silently delete the intentionally commented-out `ports` block that D-07
// requires to survive in the generated file. String composition also makes the
// key order in config.yaml 100% deterministic, which is what keeps regenerating
// the artifacts a zero-diff operation (D-02).
//
// Other hard requirements baked in here:
// - no shebang (win32; invoked only through the pnpm script `generate:app`)
// - every written string uses explicit "\n" line endings, never the platform EOL
// - exactly one trailing newline, no "---" document marker, 2-space indentation
// - lists are written as "key:" followed by "  - item", never flow style
// - no timestamps, commit hashes, or random values: same input -> identical bytes

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_PATH = join(REPO_ROOT, 'homeweave_app', 'app-metadata.json');
const REPOSITORY_YAML_PATH = join(REPO_ROOT, 'repository.yaml');
const CONFIG_YAML_PATH = join(REPO_ROOT, 'homeweave_app', 'config.yaml');

// The documentation reference kept at the top of the generated config.yaml.
// Source: Home Assistant Apps configuration reference (contributors.home-assistant.io).
const CONFIG_REFERENCE_COMMENT =
  '# Reference: https://contributors.home-assistant.io/apps/reference/configuration/';

// Why the commented-out `ports` block is kept in the artifact at all.
const PORTS_DEFERRAL_NOTE =
  "# ports stays closed until Phase 5 delivers HomeWeave's own authentication and authorization.";

const LINE_END = '\n';

function fail(path, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed: ${path}: ${message}`);
  process.exit(1);
}

function readSource() {
  try {
    return JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  } catch (error) {
    fail(SOURCE_PATH, error);
  }
}

// Emit a plain YAML scalar when it is unambiguous, otherwise a double-quoted one.
// Quote style is never load-bearing: parsers must assert parsed values only.
function scalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') {
    throw new Error(`unsupported scalar type: ${typeof value}`);
  }
  const needsQuotes =
    value === '' ||
    /^[0-9]/.test(value) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /(^|\s)#/.test(value) ||
    value.includes(': ') ||
    value.includes('?') ||
    value.trim() !== value;
  return needsQuotes ? JSON.stringify(value) : value;
}

function listBlock(key, values) {
  return [`${key}:`, ...values.map((item) => `  - ${scalar(item)}`)];
}

function buildRepositoryYaml(repository) {
  // Key order is part of the contract: name -> url -> maintainer.
  return [`name: ${scalar(repository.name)}`, `url: ${scalar(repository.url)}`, `maintainer: ${scalar(repository.maintainer)}`];
}

// schema DSL strings are derived from the semantic option definitions so the DSL
// text exists only in the generated artifact, never duplicated in the source.
function buildSchemaDsl(optionDefs) {
  const { logLevel, haUrl } = optionDefs;

  if (logLevel.type !== 'enum') {
    throw new Error(`optionDefs.logLevel.type must be "enum", got "${logLevel.type}"`);
  }
  if (haUrl.type !== 'string') {
    throw new Error(`optionDefs.haUrl.type must be "string", got "${haUrl.type}"`);
  }

  // Enum -> list(a|b|c); optional string -> str? (quoted as a whole, see scalar()).
  return {
    log_level: `list(${logLevel.values.join('|')})`,
    ha_url: haUrl.optional === true ? 'str?' : 'str',
  };
}

function buildConfigYaml(app) {
  // Key order is part of the contract (01-PATTERNS.md section 4). Any reordering
  // is a defect: it would produce a meaningless diff on every regeneration.
  const lines = [
    CONFIG_REFERENCE_COMMENT,
    `name: ${scalar(app.name)}`,
    `slug: ${scalar(app.slug)}`,
    `version: ${scalar(app.version)}`,
    `description: ${scalar(app.description)}`,
    `url: ${scalar(app.url)}`,
    ...listBlock('arch', app.arch),
    `init: ${scalar(app.init)}`,
    `image: ${scalar(app.image)}`,
    `homeassistant: ${scalar(app.homeassistant)}`,
    `homeassistant_api: ${scalar(app.homeassistant_api)}`,
    `ingress: ${scalar(app.ingress)}`,
    `ingress_port: ${scalar(app.ingress_port)}`,
  ];

  lines.push('options:');
  for (const [key, value] of Object.entries(app.options)) {
    lines.push(`  ${key}: ${scalar(value)}`);
  }

  const schema = buildSchemaDsl(app.optionDefs);
  lines.push('schema:');
  for (const [key, value] of Object.entries(schema)) {
    lines.push(`  ${key}: ${scalar(value)}`);
  }

  // Commented tail block: the `ports` declaration must survive as a comment.
  lines.push('');
  lines.push(PORTS_DEFERRAL_NOTE);
  for (const comment of app.commentedPortsComment) {
    lines.push(`# ${comment}`);
  }
  for (const blockLine of app.commentedPortsBlock) {
    lines.push(`# ${blockLine}`);
  }

  return lines;
}

function writeLines(path, lines) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines.join(LINE_END) + LINE_END, 'utf8');
  } catch (error) {
    fail(path, error);
  }
}

function main() {
  const metadata = readSource();

  const topLevelKeys = Object.keys(metadata);
  const expectedKeys = ['repository', 'app'];
  if (topLevelKeys.join('|') !== expectedKeys.join('|')) {
    fail(SOURCE_PATH, new Error(`top-level keys must be exactly ${expectedKeys.join(', ')}; got ${topLevelKeys.join(', ')}`));
  }

  const missingImage = typeof metadata.app.image === 'string' && metadata.app.image !== metadata.app.image.toLowerCase();
  if (missingImage) {
    fail(SOURCE_PATH, new Error('app.image must be lowercase (container registries reject uppercase paths)'));
  }
  if (typeof metadata.app.image === 'string' && metadata.app.image.includes(':')) {
    fail(SOURCE_PATH, new Error('app.image must not carry a tag'));
  }

  writeLines(REPOSITORY_YAML_PATH, buildRepositoryYaml(metadata.repository));
  writeLines(CONFIG_YAML_PATH, buildConfigYaml(metadata.app));
}

main();
