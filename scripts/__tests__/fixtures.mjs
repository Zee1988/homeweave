/**
 * Temp-tree fixtures for the app metadata validator tests.
 *
 * Two deliberate decisions are encoded here, both of them load-bearing:
 *
 * 1. Every fixture root comes from fs.mkdtempSync(path.join(os.tmpdir(), 'hw-app-')).
 *    A fixture must never live inside the repository tree. Supervisor discovers apps with
 *    path.glob("**\/config.*"), so a real config.yaml left behind in the repo becomes a
 *    second app -- and the validator's own V15 uniqueness check would then fail on this
 *    project itself. Keeping fixtures in the OS temp directory is what makes it safe to
 *    create as many config.yaml files as the negative cases need.
 *
 * 2. The validator derives its two input paths from process.cwd(). The tests therefore
 *    point it at a temp tree through spawnSync's `cwd` option instead of teaching the
 *    validator about tests. The file under test stays byte-identical to what CI runs, so
 *    the tests exercise the real gate rather than a test-only variant of it.
 *
 * YAML is serialized here by hand with explicit "\n" line endings. Platform defaults on
 * win32 would emit CRLF, which is harmless to js-yaml but noise we do not need.
 * Only functions are exported -- no test() is registered here -- so `node --test scripts/`
 * never treats this module as a test file.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the validator under test (same file `pnpm validate:app` runs). */
export const VALIDATOR_PATH = fileURLToPath(new URL('../validate-app-metadata.mjs', import.meta.url));

/** Repository root, derived from this module's location (never from process.cwd()). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The generated artifacts, mirrored here so the baseline is a legal input by construction. */
export const VALID_CONFIG = {
  name: 'HomeWeave',
  slug: 'homeweave',
  version: '0.1.0',
  description: 'AI Home Operating System for Home Assistant',
  url: 'https://github.com/Zee1988/homeweave/tree/master/homeweave_app',
  arch: ['amd64', 'aarch64'],
  init: false,
  image: 'ghcr.io/zee1988/homeweave-ha-app',
  homeassistant: '2026.10.0',
  homeassistant_api: true,
  ingress: true,
  ingress_port: 8099,
  options: { log_level: 'info', ha_url: '' },
  schema: { log_level: 'list(info|debug|warn)', ha_url: 'str?' },
};

export const VALID_REPOSITORY = {
  name: 'HomeWeave Apps',
  url: 'https://github.com/Zee1988/homeweave',
  maintainer: 'Zee',
};

const PLAIN_SCALAR = /^[A-Za-z0-9_./@-]+$/;

function scalar(value) {
  if (typeof value === 'string') {
    // Empty strings and anything outside the safe plain-scalar set get quoted so the
    // parsed value is always exactly the string we asked for. Quote style is irrelevant:
    // no test asserts on it, only on parsed values and exit codes.
    return PLAIN_SCALAR.test(value) ? value : JSON.stringify(value);
  }
  return String(value);
}

function serialize(value, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      lines.push(`${pad}${key}:`);
      for (const item of entry) lines.push(`${pad}  - ${scalar(item)}`);
    } else if (entry !== null && typeof entry === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(...serialize(entry, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${scalar(entry)}`);
    }
  }
  return lines;
}

/** Serialize a mapping to YAML text with explicit \n line endings and a trailing newline. */
export function toYaml(value) {
  return `${serialize(value, 0).join('\n')}\n`;
}

/**
 * The D-07 trailing block, byte-identical to the end of the real homeweave_app/config.yaml:
 * the "# ports:" heading plus the commented-out port mapping. ports stays commented until
 * Phase 5 delivers HomeWeave's own authentication and authorization.
 *
 * This constant exists because V18 asserts the warning block survives, and V18 is an
 * unconditional check -- so EVERY baseline this module writes has to carry the block, not just
 * the one makeValidTree() produces. Without it, three exit-0 cases on the makeValidTree() path
 * go red, and every negative case becomes "true for two reasons at once" (its own defect plus a
 * missing comment block) while assertDetects() can only see that one code appeared. A fixture
 * baseline that is illegal by construction makes every negative case below worthless.
 */
const PORTS_COMMENT_BLOCK = '# ports:\n#   8124/tcp: 8124\n';

/**
 * Append the D-07 comment block to a serialized config.yaml.
 *
 * The single assembly point on purpose: both writers of homeweave_app/config.yaml (makeValidTree
 * and writeConfig) go through here, so a future helper cannot forget the block and silently
 * hollow out the V18 negative case. It is deliberately NOT a general comment feature of
 * serialize()/toYaml() -- the serializer stays a plain value writer, and the one comment we
 * depend on is declared in exactly one place.
 */
export function withPortsComment(yaml) {
  return `${yaml}${PORTS_COMMENT_BLOCK}`;
}

function writeFile(root, relativePath, contents) {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
  return full;
}

/** Create a temp tree holding a fully legal pair of metadata files. */
export function makeValidTree() {
  const root = mkdtempSync(join(tmpdir(), 'hw-app-'));
  writeFile(root, 'repository.yaml', toYaml(VALID_REPOSITORY));
  writeFile(root, 'homeweave_app/config.yaml', withPortsComment(toYaml(VALID_CONFIG)));
  return root;
}

/**
 * Rewrite the app config through a mutation callback.
 * Mutations change the parsed object (delete / assign), never raw text -- string surgery
 * would silently depend on quote style, which is exactly what these tests must not do.
 */
export function writeConfig(root, mutate) {
  const next = structuredClone(VALID_CONFIG);
  mutate(next);
  // Same withPortsComment() path as makeValidTree(): a mutation must change exactly the one
  // property it names, never the D-07 block. Otherwise every negative case built here would
  // also trip V18 and pass for the wrong reason.
  return writeFile(root, 'homeweave_app/config.yaml', withPortsComment(toYaml(next)));
}

/** Rewrite the repository manifest through a mutation callback. */
export function writeRepository(root, mutate) {
  const next = structuredClone(VALID_REPOSITORY);
  mutate(next);
  return writeFile(root, 'repository.yaml', toYaml(next));
}

/** Write an extra config.yaml at an arbitrary path inside the temp tree (V15 fixtures). */
export function writeExtraConfig(root, relativePath, contents = VALID_CONFIG) {
  return writeFile(root, relativePath, toYaml(contents));
}

/**
 * Run the validator with `cwd` set to `cwd`.
 * `status` is null when the child process never started, which callers must distinguish
 * from exit code 1 -- a spawn failure is not a detection.
 */
export function runValidator(cwd) {
  return spawnSync(process.execPath, [VALIDATOR_PATH], { cwd, encoding: 'utf8' });
}

/** Remove a temp tree created by makeValidTree(). */
export function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}
