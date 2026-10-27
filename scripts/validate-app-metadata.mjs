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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();

const CONFIG_FILE = 'homeweave_app/config.yaml';
const REPOSITORY_FILE = 'repository.yaml';
const CONFIG_PATH = join(ROOT, 'homeweave_app', 'config.yaml');
const REPOSITORY_PATH = join(ROOT, 'repository.yaml');

// Every key Supervisor accepts in an app config.yaml, per the official configuration
// reference. This whitelist is the highest-value check in the phase: the Supervisor
// schema is built with extra=vol.REMOVE_EXTRA, so a misspelled key ("ingresss") is
// silently discarded instead of rejected -- the app then behaves as if the key were
// never written, with no error and no warning anywhere.
const CONFIG_ALLOWED_KEYS = new Set([
  'name',
  'slug',
  'version',
  'description',
  'url',
  'arch',
  'init',
  'image',
  'homeassistant',
  'homeassistant_api',
  'ingress',
  'ingress_port',
  'options',
  'schema',
]);

// The REQUIRED key set, derived from the whitelist above so the two cannot drift apart.
//
// Phase 1 ships the minimal field set on purpose (D-07 excludes boot / watchdog / map /
// apparmor), so today "required == allowed" is the accurate statement: every key we are
// willing to write must also be present. It is derived rather than re-listed because a second
// hand-maintained array is exactly how a key ends up allowed by V8 yet unguarded by V2 -- a
// gap between the two sets that no check owns. Adding a key to either set is therefore one
// deliberate, paired edit.
const CONFIG_REQUIRED_KEYS = [...CONFIG_ALLOWED_KEYS];

const REPOSITORY_ALLOWED_KEYS = new Set(['name', 'url', 'maintainer']);

// The REQUIRED key set for repository.yaml, derived from the whitelist above -- exactly the same
// technique as CONFIG_REQUIRED_KEYS, and for the same reason: a second hand-maintained array is
// how a key ends up allowed by V8 yet required by nobody, a gap between the two sets that no
// check owns. Today repository.yaml must carry all three keys it is allowed to carry.
//
// Deriving from a Set also fixes the iteration order (insertion order: name -> url -> maintainer),
// so the V19 failure list is stable across runs and matches the artifact's key order.
const REPOSITORY_REQUIRED_KEYS = [...REPOSITORY_ALLOWED_KEYS];

// Supervisor's ARCH_ALL is broader; we ship a strictly narrower subset on purpose so a
// multi-arch build is never declared before it actually exists.
const SUPPORTED_ARCH = ['amd64', 'aarch64'];

const LOG_LEVELS = ['info', 'debug', 'warn'];

// The literal values this phase locks into the install contract (decisions D-01a and D-03a).
//
// Changing any of these is a COSTLY change, not a routine edit: "image" decides which registry
// every installed user pulls updates from, and "version"/"homeassistant" decide what Supervisor
// considers an upgrade. Bumping a value here without a matching, deliberate CONTEXT decision
// would silently move existing installs to a different image or a different minimum HA version.
//
// This constant is a copy, NOT the source of truth. Provenance stays homeweave_app/app-metadata.json
// -> scripts/generate-app-metadata.mjs -> the generated files. V17 exists precisely because that
// chain is trusted: it is the tripwire that fires when a hand edit bypasses the chain.
const CONTRACT = {
  image: 'ghcr.io/zee1988/homeweave-ha-app',
  version: '0.1.0',
  homeassistant: '2026.10.0',
  slug: 'homeweave',
};

// Content fragments the D-07 warning block must keep. Both are asserted as substrings of the
// raw file text, never as a formatting pattern: indentation, quoting and line order are all
// free to change, because only the survival of the visible warning matters.
const PORTS_COMMENT_MARKERS = ['# ports:', '8124/tcp'];

const failures = [];
const texts = new Map();
let checksRun = 0;

function toPosix(path) {
  return path.split(sep).join('/');
}

function fail(code, file, message) {
  failures.push({ code, file, message });
}

function check(ok, code, file, message) {
  checksRun += 1;
  if (!ok) fail(code, file, message);
  return ok;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
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

  // The raw text is kept so the placeholder scan can look at the bytes we were given,
  // even when the YAML body itself failed to parse.
  texts.set(label, text);

  let data;
  try {
    data = yaml.load(text);
  } catch (error) {
    const reason = String(error.message).split('\n')[0];
    fail('V1', label, `is not valid YAML (${reason})`);
    return null;
  }

  if (!isPlainObject(data)) {
    fail('V1', label, `top level must be a mapping, got ${describe(data)}`);
    return null;
  }

  checksRun += 1;
  return data;
}

const config = readAndParse(CONFIG_PATH, CONFIG_FILE);
const repository = readAndParse(REPOSITORY_PATH, REPOSITORY_FILE);

// V2: every required key must be present in the app configuration. Presence is asserted here
// and ONLY here: V4/V5/V6/V9/V10/V11 stay wrapped in `if (has(config, key))` on purpose,
// because they answer "is the value correct", not "is the key there". Do not re-add a presence
// assertion inside those blocks -- one missing key would then be reported twice, and the total
// check count would depend on which layer happens to run.
if (config) {
  for (const key of CONFIG_REQUIRED_KEYS) {
    check(has(config, key), 'V2', CONFIG_FILE, `missing required key "${key}"`);
  }
}

// V3: the repository manifest must carry a usable name.
if (repository) {
  const name = repository.name;
  check(
    typeof name === 'string' && name.trim() !== '',
    'V3',
    REPOSITORY_FILE,
    `"name" must be a non-empty string, got ${describe(name)}`,
  );
}

// V19: repository.yaml gets the same per-key presence + type treatment as config.yaml.
//
// This is the sibling guard of V2 (presence) and V16 (type), deliberately identical in shape.
// It closes the gap those two left open: the two artifacts are generated side by side, but only
// config.yaml was guarded per key, so `maintainer: 42`, `maintainer: null`, `url: true` and a
// deleted "url" / "maintainer" line all passed with exit 0. repository.yaml is the
// WHOLE-REPOSITORY manifest: one bad value here does not degrade one app, it makes Supervisor
// reject the repository, so no app appears at all. That makes a value guard here at least as
// load-bearing as V2.
//
// Two separate loops, on purpose:
//
//   1. presence is asserted unconditionally -- wrapping it in `if (has(repository, key))` is
//      exactly the shape that silently skips the check when the key is absent, which is the
//      hole this code exists to close;
//   2. the type loop carries `if (!has(...)) continue` so that ONE missing key produces ONE
//      failure (from loop 1), not two. It does not weaken presence enforcement, and it keeps
//      the total check count from depending on which key happens to be missing.
//
// V3 stays untouched below this block, so a missing or non-string "name" reports BOTH V3 and
// V19. That double report is accepted deliberately: this validator collects failures and only
// forbids under-reporting, and deleting V3 to silence the overlap would reduce the check count.
if (repository) {
  for (const key of REPOSITORY_REQUIRED_KEYS) {
    check(
      has(repository, key),
      'V19',
      REPOSITORY_FILE,
      `missing required key "${key}" -- repository.yaml is the whole-repository manifest, so one bad key makes Supervisor fail to load the entire repository and no app appears at all`,
    );
  }
}

if (repository) {
  for (const key of REPOSITORY_REQUIRED_KEYS) {
    if (!has(repository, key)) continue;
    const value = repository[key];
    check(
      typeof value === 'string' && value.trim() !== '',
      'V19',
      REPOSITORY_FILE,
      `"${key}" must parse as a non-empty string, got ${describe(value)}`,
    );
  }
}

// V4: "version" has to survive YAML parsing as a string in x.y.z shape. An unquoted 1.10
// is read as the number 1.1 and loses its minor component; a bare 1.0 becomes 1. Both are
// silent breakage at build time, which is why this asserts the parsed type, not the quotes.
if (config && has(config, 'version')) {
  const version = config.version;
  if (typeof version !== 'string') {
    fail('V4', CONFIG_FILE, `"version" must be a string, got ${describe(version)}`);
    checksRun += 1;
  } else {
    check(
      /^\d+\.\d+\.\d+$/.test(version),
      'V4',
      CONFIG_FILE,
      `"version" must look like <major>.<minor>.<patch>, got "${version}"`,
    );
  }
}

// V5: arch must be a non-empty list drawn from the supported subset, without repeats.
if (config && has(config, 'arch')) {
  const arch = config.arch;
  const isList = Array.isArray(arch) && arch.length > 0;
  check(isList, 'V5', CONFIG_FILE, `"arch" must be a non-empty list, got ${describe(arch)}`);
  if (isList) {
    const unsupported = arch.filter((entry) => !SUPPORTED_ARCH.includes(entry));
    check(
      unsupported.length === 0,
      'V5',
      CONFIG_FILE,
      `"arch" contains unsupported values: ${unsupported.map(String).join(', ')} (allowed: ${SUPPORTED_ARCH.join(', ')})`,
    );
    const duplicates = [...new Set(arch.filter((entry, index) => arch.indexOf(entry) !== index))];
    check(
      duplicates.length === 0,
      'V5',
      CONFIG_FILE,
      `"arch" contains duplicate entries: ${duplicates.join(', ')}`,
    );
  }
}

// V6: image must be a bare ghcr.io/ reference without a tag. Tag detection looks only at
// the last path segment so a registry port (ghcr.io:443/owner/name) is never mistaken for
// a tag. V7 (tag versus version mismatch) is folded in here on purpose: with no tag there
// is nothing to disagree with "version", so a separate code would have nothing to check.
if (config && has(config, 'image')) {
  const image = config.image;
  const isUsableString = typeof image === 'string' && image.trim() !== '';
  check(isUsableString, 'V6', CONFIG_FILE, `"image" must be a non-empty string, got ${describe(image)}`);
  if (isUsableString) {
    check(
      !image.includes('{arch}'),
      'V6',
      CONFIG_FILE,
      `"image" must not contain the {arch} placeholder, got "${image}"`,
    );
    check(
      image.startsWith('ghcr.io/'),
      'V6',
      CONFIG_FILE,
      `"image" must be prefixed with ghcr.io/, got "${image}"`,
    );
    const lastSegment = image.split('/').pop();
    check(
      !lastSegment.includes(':'),
      'V6',
      CONFIG_FILE,
      `"image" must not carry a tag (the tag is derived from "version" at build time), got "${image}"`,
    );
  }
}

// V8: key whitelists. Anything not listed here is silently dropped by Supervisor.
if (config) {
  for (const key of Object.keys(config)) {
    check(
      CONFIG_ALLOWED_KEYS.has(key),
      'V8',
      CONFIG_FILE,
      `unknown key "${key}" -- Supervisor builds its schema with extra=vol.REMOVE_EXTRA, so unknown keys are silently dropped instead of rejected`,
    );
  }
}

if (repository) {
  for (const key of Object.keys(repository)) {
    check(
      REPOSITORY_ALLOWED_KEYS.has(key),
      'V8',
      REPOSITORY_FILE,
      `unknown key "${key}" -- unrecognised repository.yaml keys are ignored, so a typo would go unnoticed`,
    );
  }
}

// V9: boolean flags must be real booleans. The string "true" is truthy in YAML but not a
// boolean, and Supervisor validates the type before it ever looks at the value.
if (config) {
  for (const key of ['init', 'ingress', 'homeassistant_api']) {
    if (has(config, key)) {
      check(
        typeof config[key] === 'boolean',
        'V9',
        CONFIG_FILE,
        `"${key}" must be a boolean (unquoted true/false), got ${describe(config[key])}`,
      );
    }
  }
}

// V10: ingress_port must be an integer in 0..65535. Zero is the documented way to ask
// Supervisor to pick a free port between 62000 and 65500 on our behalf.
if (config && has(config, 'ingress_port')) {
  const port = config.ingress_port;
  check(
    Number.isInteger(port) && port >= 0 && port <= 65535,
    'V10',
    CONFIG_FILE,
    `"ingress_port" must be an integer in 0..65535 (0 asks Supervisor to allocate one from 62000-65500), got ${describe(port)} "${port}"`,
  );
}

const options = config && isPlainObject(config.options) ? config.options : {};
const schema = config && isPlainObject(config.schema) ? config.schema : {};

if (config) {
  if (has(config, 'options')) {
    check(
      isPlainObject(config.options),
      'V11',
      CONFIG_FILE,
      `"options" must be a mapping of default values, got ${describe(config.options)}`,
    );
  }
  if (has(config, 'schema')) {
    check(
      isPlainObject(config.schema),
      'V11',
      CONFIG_FILE,
      `"schema" must be a mapping of option types, got ${describe(config.schema)}`,
    );
  }
}

// V11: schema and options are two halves of one contract -- every schema key needs a
// default in options or a trailing "?" (optional), and every option needs a declared type.
for (const key of Object.keys(schema)) {
  const declaredInOptions = has(options, key);
  const optional = typeof schema[key] === 'string' && schema[key].endsWith('?');
  check(
    declaredInOptions || optional,
    'V11',
    CONFIG_FILE,
    `schema key "${key}" has no default value in options and is not optional (no trailing "?")`,
  );
}

for (const key of Object.keys(options)) {
  check(
    has(schema, key),
    'V11',
    CONFIG_FILE,
    `options key "${key}" is not declared in schema, so Supervisor cannot type-check or render it`,
  );
}

// V12: the two options shipped in Phase 1, checked as exact DSL strings (mini-DSL subset
// only: str, bool, list(...), int(min,max), password, device -- not full JSON Schema).
if (config) {
  check(
    schema.log_level === 'list(info|debug|warn)',
    'V12',
    CONFIG_FILE,
    `schema.log_level must be exactly "list(info|debug|warn)", got "${schema.log_level}"`,
  );
  check(
    schema.ha_url === 'str?',
    'V12',
    CONFIG_FILE,
    `schema.ha_url must be exactly "str?" (a string with no default required), got "${schema.ha_url}"`,
  );
  check(
    LOG_LEVELS.includes(options.log_level),
    'V12',
    CONFIG_FILE,
    `options.log_level must be one of ${LOG_LEVELS.join('|')}, got "${options.log_level}"`,
  );
  // An empty ha_url is valid and is the safe default: it tells HomeWeave to fall back to
  // Supervisor's own Home Assistant discovery instead of a user-supplied URL.
  check(
    typeof options.ha_url === 'string',
    'V12',
    CONFIG_FILE,
    `options.ha_url must be a string (empty string means Home Assistant auto-discovery), got ${describe(options.ha_url)}`,
  );
}

// V13: no generic placeholders may survive into the two generated files. Scope is exactly
// these two files on purpose: examples/home-assistant-app/*.example keep their <owner> and
// <repo> tokens deliberately (see examples/README.md), so scanning the whole repo here
// would fail forever.
const PLACEHOLDER_LITERALS = [
  '<owner>',
  '<repo>',
  '<maintainer name or contact>',
  'tree/main',
];

for (const label of [CONFIG_FILE, REPOSITORY_FILE]) {
  const text = texts.get(label);
  if (text === undefined) continue;
  for (const literal of PLACEHOLDER_LITERALS) {
    check(!text.includes(literal), 'V13', label, `still contains the placeholder "${literal}"`);
  }
}

// V14: a /tree/<branch> source link must point at master. The templates said main, which
// does not exist in this repository, so the link would 404 for anyone reading the app page.
// url is optional in config.yaml, so an absent url is not a failure -- but a present one
// has to be right.
const TREE_SEGMENT = /\/tree\/([^/\s]+)/;

for (const [label, data] of [
  [CONFIG_FILE, config],
  [REPOSITORY_FILE, repository],
]) {
  if (!data || typeof data.url !== 'string') continue;
  const match = TREE_SEGMENT.exec(data.url);
  if (match) {
    check(
      match[1] === 'master',
      'V14',
      label,
      `"url" points at /tree/${match[1]}; the default branch is master, so /tree/${match[1]} would 404`,
    );
  }
}

// V16: type and shape of the string-valued fields. This is the "YAML parsed the value into
// something we did not expect" family -- the silent-information-loss trap V4 already guards for
// "version", generalised to the rest of the fields. Two failure shapes live here:
//
//   - the node is not a string at all (a bare 12345 becomes a number, [alpha] becomes a list);
//   - the node is a string but does not match the shape Supervisor expects.
//
// Every assertion reads the PARSED value, never the source text: quote style is not checked
// anywhere in this file, because `slug: homeweave` and `slug: "homeweave"` are the same value.
//
// The has() wrapper below is the one place it is allowed. Presence belongs to V2, so wrapping
// here means "skip the shape check when V2 has already reported the key missing" -- it does not
// weaken presence enforcement, and it keeps one missing key from producing two failures.
const STRING_FIELDS = ['name', 'slug', 'version', 'description', 'url', 'homeassistant'];

// Supervisor's own RE_SLUG: lowercase alphanumerics plus _ and -, never starting with a
// separator. A slug that fails this is rejected on the Supervisor side, which we cannot test.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

// An unquoted 2026.10 is parsed as the float 2026.1, exactly like an unquoted 1.10 for
// "version": the trailing component is silently lost, so the declared minimum HA version
// becomes a different, weaker one without any error.
const VERSION_TRIPLE_PATTERN = /^\d+\.\d+\.\d+$/;

if (config) {
  for (const key of STRING_FIELDS) {
    if (!has(config, key)) continue;
    const value = config[key];
    check(
      typeof value === 'string' && value.trim() !== '',
      'V16',
      CONFIG_FILE,
      `"${key}" must parse as a non-empty string, got ${describe(value)}`,
    );
  }

  if (has(config, 'slug') && typeof config.slug === 'string') {
    check(
      SLUG_PATTERN.test(config.slug),
      'V16',
      CONFIG_FILE,
      `"slug" must match ${SLUG_PATTERN.source} (Supervisor's RE_SLUG), got "${config.slug}"`,
    );
  }

  if (has(config, 'homeassistant') && typeof config.homeassistant === 'string') {
    check(
      VERSION_TRIPLE_PATTERN.test(config.homeassistant),
      'V16',
      CONFIG_FILE,
      `"homeassistant" must look like <major>.<minor>.<patch>, got "${config.homeassistant}"`,
    );
  }
}

// V17: the contract literals. V6 already proves the image is a bare ghcr.io/ reference; this
// proves it is OUR reference, and that version / homeassistant / slug are the exact values
// D-01a and D-03a locked. Without it, "the artifact happens to be correct today" is the only
// guarantee -- a hand edit that changes the owner, the image name or the minimum HA version
// would still pass every other check and silently redirect existing installs.
//
// has() is used only to avoid reporting the same missing key twice (V2 owns presence).
if (config) {
  for (const [key, expected] of Object.entries(CONTRACT)) {
    if (!has(config, key)) continue;
    check(
      config[key] === expected,
      'V17',
      CONFIG_FILE,
      `"${key}" must be exactly "${expected}" (D-01a/D-03a contract; changing it changes the install contract for existing users), got ${describe(config[key])} "${config[key]}"`,
    );
  }
}

// V18: the D-07 warning block must survive in the generated config.yaml.
//
// ports stays commented out until Phase 5 ships HomeWeave's own auth; the block is the only
// in-file record of why. A generated file is easy to regenerate and easy to "tidy", and a
// serialiser would drop the comment without a word -- so its survival is asserted instead of
// reviewed. This is a CONTENT assertion: it does not care about indentation width, quote style
// or line order.
const configText = texts.get(CONFIG_FILE);
if (configText !== undefined) {
  for (const marker of PORTS_COMMENT_MARKERS) {
    check(
      configText.includes(marker),
      'V18',
      CONFIG_FILE,
      `the commented-out ports block lost "${marker}"; D-07 keeps ports disabled until HomeWeave's own auth exists, and this block is the only in-file record of why`,
    );
  }
}

// V15: exactly one Supervisor-discoverable config file may exist in the repository.
//
// Supervisor discovers apps with path.glob("**/config.*") and keeps only paths whose every
// segment avoids a leading "." and the name "rootfs"; the .example suffix survives purely
// because it is not in FILE_SUFFIX_CONFIGURATION. A second real config.yaml anywhere in the
// tree therefore becomes a second app, so uniqueness is asserted rather than reviewed.
const CONFIG_BASENAME = /^config\.(yaml|yml|json)$/;
// rootfs is a Supervisor rule. node_modules is NOT: Supervisor scans a clean clone, while
// this validator also runs on developer machines where a dependency could ship its own
// config.yaml. Skipping it is a local false-positive guard only -- it cannot mask a real
// second app, because apps live in tracked directories, never inside node_modules.
const SKIP_DIRECTORIES = new Set(['rootfs', 'node_modules']);
const MAX_DEPTH = 12;

function findConfigCandidates(directory, depth = 0) {
  const found = [];
  if (depth > MAX_DEPTH) return found;

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found; // unreadable or vanished directory: skip it instead of throwing
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;

    const full = join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      try {
        const stats = statSync(full);
        isDirectory = stats.isDirectory();
        isFile = stats.isFile();
      } catch {
        continue; // broken link
      }
    }

    if (isDirectory) {
      found.push(...findConfigCandidates(full, depth + 1));
    } else if (isFile && CONFIG_BASENAME.test(entry.name)) {
      found.push(toPosix(relative(ROOT, full)));
    }
  }

  return found;
}

const candidates = findConfigCandidates(ROOT);
const candidateList = candidates.length > 0 ? candidates.join(', ') : '(none)';

if (
  check(
    candidates.length === 1,
    'V15',
    CONFIG_FILE,
    `expected exactly one Supervisor-discoverable config file, found ${candidates.length}: ${candidateList}`,
  )
) {
  check(
    candidates[0] === CONFIG_FILE,
    'V15',
    CONFIG_FILE,
    `the single discoverable config file must be ${CONFIG_FILE}, found ${candidateList}`,
  );
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
