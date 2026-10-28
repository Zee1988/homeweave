#!/usr/bin/env node
/**
 * HomeWeave workflow validator -- makes the release contract executable.
 *
 * WHY THIS FILE EXISTS
 * The release ordering ("image first, git tag second"), the permission split and
 * the build-push flags are all things that a YAML file can silently get wrong
 * while every command in it still exits 0. `verify-image` running an assertion
 * script that nothing executes is the same class of bug as a `publish` job that
 * quietly builds with provenance on. This validator turns each of those into a
 * named rule with a failing example in `validate-workflows.test.mjs`.
 *
 * HARD CONSTRAINT: assertions read PARSED values, never serialised text.
 * The previous design used `JSON.stringify(workflow)` plus substring matching and
 * was broken in a way that looks fine: YAML `provenance: false` becomes the
 * boolean `false`, which serialises to `"provenance":false` (no space), so
 * `includes('provenance: false')` never matched -- the assertion was green for
 * every input. Every rule below therefore takes the object graph from js-yaml and
 * compares values with `===`. If you find yourself reaching for `String(doc)`,
 * stop: write a rule that reads `job.steps[n].with.provenance` instead.
 *
 * READING THE RULES
 * Each exported `check*` function returns `string[]` of problems (empty = pass).
 * They never print and never throw: the CLI collects every problem from every
 * applicable rule and prints them together, so one run reports everything.
 * `checkFiles` is the exception that keeps the tool honest -- a missing workflow
 * file IS a problem, so `--profile all` on a checkout without `.github/` exits 1
 * instead of printing "ok" over files that were never read.
 *
 * Dependency policy: `js-yaml` only (already a devDependency; parsing a workflow
 * with a hand-rolled reader is how you end up with string comparisons again).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const WORKFLOW_DIR = '.github/workflows';

/** Which files each profile needs. `all` needs both, so a missing file fails. */
export const PROFILES = {
  ci: ['ci.yml'],
  release: ['release.yml'],
  all: ['ci.yml', 'release.yml'],
};

/** The exact platform pair the publish job must build (IMG-04). */
export const REQUIRED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

/**
 * The hard-coded dependency edges. These are the ordering guarantee itself: as
 * long as `tag` needs `verify-image`, the git tag cannot exist before a pullable
 * image does. Do not derive them from the file -- a derived edge set agrees with
 * whatever the file happens to say.
 */
export const EDGES = {
  ci: { static: [] },
  release: {
    static: ['guard'],
    publish: ['static'],
    'verify-image': ['publish', 'static'],
    tag: ['guard', 'verify-image'],
  },
};

/** `uses:` values are pinned to a major tag, e.g. `actions/checkout@v7`. */
const PINNED_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@v\d+(\.\d+\.\d+)?$/;

const CHECKOUT = 'actions/checkout@v7';
const BUILD_PUSH_PREFIX = 'docker/build-push-action@';

/** Tokens `verify-image` must actually reference (02-03's script is not an orphan). */
const VERIFY_IMAGE_SNIPPETS = [
  'assert-image.sh',
  'assert-manifest-platforms.mjs',
  'docker logout',
  '.docker/config.json',
  'docker pull',
];

/** Tokens the `static` gate in ci.yml must run. */
export const CI_GATE_TOKENS = [
  'validate:workflows',
  'validate:app',
  'validate:dockerfile',
  'lint',
  'typecheck',
  'test',
  'check:app',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function has(object, key) {
  return isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function describe(value) {
  if (value === undefined) return 'nothing (key absent)';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') return `string "${value}"`;
  return `${typeof value} ${String(value)}`;
}

/** Normalises a scalar-or-list YAML value into an array (needs, on, tags). */
function asArray(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function jobsOf(doc) {
  return isPlainObject(doc) && isPlainObject(doc.jobs) ? doc.jobs : {};
}

function jobOf(doc, jobName) {
  const jobs = jobsOf(doc);
  return has(jobs, jobName) ? jobs[jobName] : null;
}

function stepsOf(doc, jobName) {
  const job = jobOf(doc, jobName);
  if (!isPlainObject(job) || !Array.isArray(job.steps)) return [];
  return job.steps.filter((step) => isPlainObject(step));
}

/** Every `run:` text in one job, already joined for substring assertions. */
function runTextOfJob(doc, jobName) {
  return stepsOf(doc, jobName)
    .map((step) => (typeof step.run === 'string' ? step.run : ''))
    .join('\n');
}

/** Every `run:` text in the whole document. */
function runTextOfDoc(doc) {
  const chunks = [];
  for (const jobName of Object.keys(jobsOf(doc))) chunks.push(runTextOfJob(doc, jobName));
  return chunks.join('\n');
}

/** The normalised trigger set of `on:` (string shorthand included). */
function triggersOf(doc) {
  if (!isPlainObject(doc) || !has(doc, 'on')) return [];
  const on = doc.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isPlainObject(on)) return Object.keys(on);
  return [];
}

/** Job-level permissions object, or null when the job declares none. */
function jobPermissions(doc, jobName) {
  const job = jobOf(doc, jobName);
  return isPlainObject(job) && isPlainObject(job.permissions) ? job.permissions : null;
}

/**
 * F7 -- every required workflow file must exist.
 *
 * A missing file is a problem, never a skip: `validate-workflows.mjs` printing
 * "ok" for a checkout that has no `.github/workflows` would make the gate pass
 * while asserting nothing at all.
 *
 * @param {'ci'|'release'|'all'} profile
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function checkFiles(profile, cwd = process.cwd()) {
  const wanted = PROFILES[profile];
  if (wanted === undefined) {
    return [`unknown profile "${profile}" (expected one of ${Object.keys(PROFILES).join('|')})`];
  }

  const problems = [];
  for (const name of wanted) {
    const relative = `${WORKFLOW_DIR}/${name}`;
    try {
      readFileSync(path.join(cwd, WORKFLOW_DIR, name), 'utf8');
    } catch (error) {
      problems.push(`missing workflow file: ${relative} (${error.code || error.message})`);
    }
  }
  return problems;
}

/**
 * F1 -- no `pull_request_target` (threat T-02-06).
 *
 * `pull_request_target` runs with a writable token in the context of the base
 * repository while checking out untrusted PR code. There is no version of that
 * which is safe here, so it is banned outright rather than constrained.
 *
 * @param {object|null} doc
 * @returns {string[]}
 */
export function checkNoPrivilegedPrTrigger(doc) {
  if (!isPlainObject(doc)) return [];
  const triggers = triggersOf(doc);
  if (triggers.length === 0) return ['workflow declares no "on:" triggers, so its privilege level cannot be assessed'];
  if (triggers.includes('pull_request_target')) {
    return [
      'uses pull_request_target: it runs with a writable token against untrusted PR code; use pull_request with read-only permissions (T-02-06)',
    ];
  }
  return [];
}

/**
 * F2 -- the top-level permission set and the job-level escalations.
 *
 * `allow` names the jobs permitted to escalate. A job that escalates without
 * being listed is a problem, and so is a listed job that does not exist (the
 * allowance would silently apply to nothing after a rename).
 *
 * @param {object|null} doc
 * @param {{packagesWrite?: string[], contentsWrite?: string[]}} [allow]
 * @returns {string[]}
 */
export function checkPermissions(doc, allow = {}) {
  if (!isPlainObject(doc)) return [];

  const packagesWrite = asArray(allow.packagesWrite).map(String);
  const contentsWrite = asArray(allow.contentsWrite).map(String);
  const problems = [];

  const permissions = has(doc, 'permissions') ? doc.permissions : undefined;
  if (!isPlainObject(permissions)) {
    problems.push(
      'top-level "permissions" must be declared as a mapping and exactly {contents: read}; declaring nothing grants the repository default, which may be write',
    );
  } else {
    const keys = Object.keys(permissions).sort();
    const extra = keys.filter((key) => key !== 'contents');
    if (extra.length > 0) {
      problems.push(`top-level "permissions" must be exactly {contents: read}; found extra scope(s): ${extra.join(', ')}`);
    }
    if (permissions.contents !== 'read') {
      problems.push(`top-level "permissions.contents" must be "read", got ${describe(permissions.contents)}`);
    }
  }

  for (const jobName of Object.keys(jobsOf(doc))) {
    const jobPermissions_ = jobPermissions(doc, jobName);
    if (jobPermissions_ === null) continue;

    for (const [scope, value] of Object.entries(jobPermissions_)) {
      if (value !== 'write') continue;
      if (scope === 'packages' && packagesWrite.includes(jobName)) continue;
      if (scope === 'contents' && contentsWrite.includes(jobName)) continue;
      const allowedFor =
        scope === 'packages'
          ? packagesWrite.join(', ') || '(no job)'
          : scope === 'contents'
            ? contentsWrite.join(', ') || '(no job)'
            : '(no job may request this scope)';
      problems.push(
        `job "${jobName}" requests "${scope}: write", which is only allowed for: ${allowedFor} (T-02-06 keeps writable tokens out of read-only jobs)`,
      );
    }
  }

  for (const jobName of packagesWrite) {
    if (jobOf(doc, jobName) === null) {
      problems.push(`job "${jobName}" is allowed "packages: write" but does not exist in this workflow`);
    }
  }
  for (const jobName of contentsWrite) {
    if (jobOf(doc, jobName) === null) {
      problems.push(`job "${jobName}" is allowed "contents: write" but does not exist in this workflow`);
    }
  }

  return problems;
}

/**
 * F3 -- every `uses:` is pinned to a version tag.
 *
 * `@main`, `@master` and a bare `owner/action` all resolve to "whatever the
 * upstream default branch holds today", which is an unreviewable change to the
 * release chain (research §4.1 lists the verified major tags).
 *
 * @param {object|null} doc
 * @returns {string[]}
 */
export function checkPinnedActions(doc) {
  if (!isPlainObject(doc)) return [];
  const problems = [];

  for (const jobName of Object.keys(jobsOf(doc))) {
    stepsOf(doc, jobName).forEach((step, index) => {
      if (!has(step, 'uses')) return;
      const uses = step.uses;
      if (typeof uses !== 'string' || !PINNED_ACTION.test(uses)) {
        problems.push(
          `job "${jobName}" step ${index + 1} uses ${describe(uses)}; every action must be pinned as owner/action@vN (no @main, no @master, no floating reference)`,
        );
      }
    });
  }

  return problems;
}

/**
 * F4 -- the dependency graph, plus the reverse edge.
 *
 * The reverse assertion matters as much as the forward ones: hanging `tag` off
 * `publish` instead of `verify-image` would satisfy "tag runs after a build"
 * while dropping the only check that the image is pullable without credentials.
 *
 * @param {object|null} doc
 * @param {Record<string, string[]>} edges
 * @returns {string[]}
 */
export function checkJobGraph(doc, edges = {}) {
  if (!isPlainObject(doc)) return [];
  const problems = [];

  for (const [jobName, requiredNeeds] of Object.entries(edges)) {
    const job = jobOf(doc, jobName);
    if (job === null) {
      problems.push(`job "${jobName}" is missing, so the required dependency edge set cannot be satisfied`);
      continue;
    }
    const needs = asArray(isPlainObject(job) ? job.needs : undefined).map(String);
    const missing = asArray(requiredNeeds)
      .map(String)
      .filter((required) => !needs.includes(required));
    if (missing.length > 0) {
      problems.push(
        `job "${jobName}".needs must include [${asArray(requiredNeeds).map(String).join(', ')}], missing [${missing.join(', ')}], actual needs [${needs.join(', ') || '(none)'}]`,
      );
    }
  }

  // Reverse edge: `publish` may be a prerequisite of `verify-image` only.
  if (jobOf(doc, 'publish') !== null) {
    for (const jobName of Object.keys(jobsOf(doc))) {
      if (jobName === 'verify-image') continue;
      const needs = asArray(isPlainObject(jobOf(doc, jobName)) ? jobOf(doc, jobName).needs : undefined).map(String);
      if (needs.includes('publish')) {
        problems.push(
          `job "${jobName}".needs must not include "publish"; only "verify-image" may depend on it, otherwise the tag can be created without passing the anonymous-pull check`,
        );
      }
    }
  }

  return problems;
}

/** Tokens the `guard` job must contain -- BOTH branches, or one branch can vanish. */
const GUARD_SNIPPETS = ['check-tag-free.mjs', '--expect free', '--expect exists', '--allow-missing-package', 'GH_TOKEN'];

/** Tokens the `publish` job must contain before it builds anything. */
const PUBLISH_SNIPPETS = ['check-tag-free.mjs', '--allow-missing-package', 'GH_TOKEN'];

/** Tokens the `tag` job must contain -- a local-only tag is not a delivery. */
const TAG_SNIPPETS = ['git config user.email', 'git tag', 'git push'];

function firstLine(text) {
  return String(text).split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
}

/**
 * F5 -- the build-push flags, read as booleans.
 *
 * The `uses`-step requirement comes FIRST on purpose. Without it, replacing the
 * action with `run: docker buildx build --push ...` would satisfy every other
 * rule in this file: there is no `with:` block to inspect, so push/provenance/
 * sbom silently stop being asserted while the image still gets published.
 *
 * @param {object|null} doc
 * @param {string} [jobName]
 * @returns {string[]}
 */
export function checkBuildPushFlags(doc, jobName = 'publish') {
  if (!isPlainObject(doc)) return [];
  if (jobOf(doc, jobName) === null) {
    return [`job "${jobName}" is missing, so the build-push contract (push/provenance/sbom/platforms) cannot be asserted`];
  }

  const steps = stepsOf(doc, jobName);
  const step = steps.find(
    (candidate) => typeof candidate.uses === 'string' && candidate.uses.startsWith(BUILD_PUSH_PREFIX),
  );

  if (step === undefined) {
    return [
      `job "${jobName}" has no step whose "uses" starts with ${BUILD_PUSH_PREFIX}; without that step none of the flags below are asserted, and a \`run: docker buildx build --push\` step would bypass them all`,
    ];
  }

  if (!isPlainObject(step.with)) {
    return [`the ${BUILD_PUSH_PREFIX} step in job "${jobName}" has no "with:" mapping, so push/provenance/sbom/platforms are all undefined`];
  }

  const withBlock = step.with;
  const problems = [];

  const expectBoolean = (key, expected) => {
    const actual = withBlock[key];
    if (actual === expected) return;
    const quoted =
      typeof actual === 'string'
        ? ` (got the string "${actual}": a quoted value does not ${expected ? 'enable' : 'disable'} ${key}; this rule compares parsed booleans, never serialised text)`
        : '';
    problems.push(`with.${key} must be the boolean ${expected}, got ${describe(actual)}${quoted}`);
  };

  expectBoolean('push', true);
  expectBoolean('provenance', false);
  expectBoolean('sbom', false);

  const rawPlatforms = withBlock.platforms;
  const platformList =
    typeof rawPlatforms === 'string'
      ? rawPlatforms.split(',')
      : Array.isArray(rawPlatforms)
        ? rawPlatforms.map(String)
        : null;
  if (platformList === null) {
    problems.push(`with.platforms must be a comma-separated string, got ${describe(rawPlatforms)}`);
  } else {
    const actual = platformList
      .map((entry) => String(entry).trim())
      .filter((entry) => entry !== '')
      .sort();
    const wanted = [...REQUIRED_PLATFORMS].sort();
    if (actual.length !== wanted.length || actual.some((entry, position) => entry !== wanted[position])) {
      problems.push(`with.platforms must be exactly [${wanted.join(', ')}], got [${actual.join(', ')}]`);
    }
  }

  if (withBlock.context !== '.') {
    problems.push(
      `with.context must be "." (the Dockerfile needs the repo root: pnpm-lock.yaml and apps/api live there, not under ./homeweave_app), got ${describe(withBlock.context)}`,
    );
  }

  if (withBlock.file !== './Dockerfile') {
    problems.push(`with.file must be "./Dockerfile", got ${describe(withBlock.file)}`);
  }

  const rawTags = withBlock.tags;
  const tagList =
    typeof rawTags === 'string' ? [rawTags] : Array.isArray(rawTags) ? rawTags.map(String) : null;
  if (tagList === null) {
    problems.push(`with.tags must be a string or list, got ${describe(rawTags)}`);
  } else {
    const joined = tagList.join('\n');
    if (!joined.includes('type=raw,value=')) {
      problems.push(
        `with.tags must contain "type=raw,value=<version>" so the pushed tag is exactly config.yaml's version, got ${describe(rawTags)}`,
      );
    }
    for (const banned of ['type=semver', 'latest', 'type=sha']) {
      if (joined.toLowerCase().includes(banned)) {
        problems.push(
          `with.tags must not use "${banned}": it produces tags other than the config.yaml version, so the image tag and the git tag diverge ("tag 一字不差")`,
        );
      }
    }
  }

  return problems;
}

/**
 * F6 -- no build may happen through `run:`.
 *
 * A shell build carries neither the pinned action version nor the auditable
 * flag set, and `--push` inside `run:` has no `with.provenance` to inspect.
 *
 * @param {object|null} doc
 * @param {string} [jobName]
 * @returns {string[]}
 */
export function checkNoShellBuild(doc, jobName = 'publish') {
  if (!isPlainObject(doc)) return [];
  if (jobOf(doc, jobName) === null) return [];

  const text = runTextOfJob(doc, jobName);
  const problems = [];
  for (const banned of ['docker build', 'docker buildx build', '--push']) {
    if (text.includes(banned)) {
      problems.push(
        `job "${jobName}" runs "${banned}" in a run: step; the image must be built and pushed only by ${BUILD_PUSH_PREFIX}, otherwise push/provenance/sbom are unauditable`,
      );
    }
  }
  return problems;
}

/**
 * F8 -- required tokens are present in a job's executable surface.
 *
 * The surface is every step's `run:` text PLUS every step's `env:` keys and
 * values. Scoping it to `run:` only would make the "GH_TOKEN" assertion
 * unsatisfiable by a correct workflow: the token is declared in `env:`, never
 * in the command line. Job-level `env:` is deliberately excluded so the token
 * has to sit next to the command that needs it.
 *
 * @param {object|null} doc
 * @param {string} jobName
 * @param {string[]} snippets
 * @returns {string[]}
 */
export function checkStepRuns(doc, jobName, snippets = []) {
  if (!isPlainObject(doc)) return [];
  if (jobOf(doc, jobName) === null) {
    return [`job "${jobName}" is missing, so its required steps cannot be asserted`];
  }

  const parts = [];
  for (const step of stepsOf(doc, jobName)) {
    if (typeof step.run === 'string') parts.push(step.run);
    if (isPlainObject(step.env)) {
      for (const [key, value] of Object.entries(step.env)) {
        parts.push(key);
        parts.push(typeof value === 'string' ? value : String(value));
      }
    }
  }
  const surface = parts.join('\n');

  return asArray(snippets)
    .map(String)
    .filter((snippet) => !surface.includes(snippet))
    .map(
      (snippet) =>
        `job "${jobName}" must reference "${snippet}" in a step's run: or env: -- without it the release contract is only documented, not executed`,
    );
}

/**
 * F9 -- the ci.yml gate sequence.
 *
 * These seven tokens are the entire static gate; a missing one is a check that
 * silently stopped running. `build-push-action` / `docker build` are banned
 * because ci.yml must never build (no registry credentials, untrusted forks).
 *
 * @param {object|null} doc
 * @returns {string[]}
 */
export function checkCiGates(doc) {
  if (!isPlainObject(doc)) return [];

  const text = runTextOfDoc(doc);
  const problems = [];

  const missing = CI_GATE_TOKENS.filter((token) => !text.includes(token));
  if (missing.length > 0) {
    problems.push(
      `the static gate must run all of [${CI_GATE_TOKENS.join(', ')}]; missing [${missing.join(', ')}]`,
    );
  }

  if (text.includes('build-push-action')) {
    problems.push('ci.yml must not use build-push-action: pull request runs get no registry credentials by design');
  }
  if (text.includes('docker build')) {
    problems.push('ci.yml must not run "docker build": the CI workflow is a static gate only');
  }

  return problems;
}

/**
 * F10 -- the dispatch contract.
 *
 * `resume_from_verify` must be a boolean whose default is false: the exception
 * path has to be opt-in and visible in the run record, never the default.
 *
 * @param {object|null} doc
 * @returns {string[]}
 */
export function checkDispatch(doc) {
  if (!isPlainObject(doc)) return [];

  const problems = [];
  const on = has(doc, 'on') ? doc.on : undefined;

  if (!isPlainObject(on)) {
    problems.push(`"on:" must be a mapping that declares workflow_dispatch, got ${describe(on)}`);
    return problems;
  }

  const triggers = Object.keys(on);
  if (triggers.length !== 1 || triggers[0] !== 'workflow_dispatch') {
    problems.push(`"on:" must declare exactly [workflow_dispatch] (a release must be started by a human with an explicit version), got [${triggers.join(', ')}]`);
  }

  const dispatch = has(on, 'workflow_dispatch') ? on.workflow_dispatch : undefined;
  const inputs = isPlainObject(dispatch) && isPlainObject(dispatch.inputs) ? dispatch.inputs : null;
  if (inputs === null) {
    problems.push('workflow_dispatch must declare an "inputs:" mapping (version, confirm_version, resume_from_verify)');
    return problems;
  }

  const version = has(inputs, 'version') ? inputs.version : undefined;
  if (!isPlainObject(version) || version.required !== true) {
    problems.push(`inputs.version.required must be the boolean true, got ${describe(isPlainObject(version) ? version.required : version)}`);
  }

  // The message below already promised this input, so not checking it would let a
  // release workflow lose the double-entry guard without any local rule noticing.
  const confirm = has(inputs, 'confirm_version') ? inputs.confirm_version : undefined;
  if (!isPlainObject(confirm) || confirm.required !== true) {
    problems.push(
      `inputs.confirm_version.required must be the boolean true (the version is typed twice on purpose), got ${describe(
        isPlainObject(confirm) ? confirm.required : confirm,
      )}`,
    );
  }

  const resume = has(inputs, 'resume_from_verify') ? inputs.resume_from_verify : undefined;
  if (!isPlainObject(resume)) {
    problems.push(`inputs.resume_from_verify must be declared as a boolean input, got ${describe(resume)}`);
    return problems;
  }
  if (resume.type !== 'boolean') {
    problems.push(`inputs.resume_from_verify.type must be "boolean", got ${describe(resume.type)}`);
  }
  if (resume.default !== false) {
    problems.push(`inputs.resume_from_verify.default must be the boolean false (the resume path is an exception, not the default), got ${describe(resume.default)}`);
  }

  return problems;
}

/** Collapses whitespace and normalises quotes so an expression is compared by meaning. */
function normalizeExpression(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/"/g, "'");
}

/**
 * F11 -- the resume branch, including the inversion trap.
 *
 * `verify-image` may run when `publish` was SKIPPED, never when it FAILED. A
 * condition written as `needs.publish.result != 'skipped'` reads almost the same
 * and inverts the meaning while still containing the word "skipped", so the
 * forbidden form is asserted explicitly rather than inferred.
 *
 * @param {object|null} doc
 * @returns {string[]}
 */
export function checkResumePath(doc) {
  if (!isPlainObject(doc)) return [];

  const problems = [];
  const publish = jobOf(doc, 'publish');
  const verify = jobOf(doc, 'verify-image');

  if (publish === null) {
    problems.push('job "publish" is missing, so the resume condition cannot be asserted');
  } else {
    const publishIf = normalizeExpression(isPlainObject(publish) ? publish.if : undefined);
    if (!publishIf.includes('!inputs.resume_from_verify')) {
      problems.push(
        `publish.if must contain "!inputs.resume_from_verify" so a resume run never rebuilds the image, got ${describe(isPlainObject(publish) ? publish.if : undefined)}`,
      );
    }
  }

  if (verify === null) {
    problems.push('job "verify-image" is missing, so the resume condition cannot be asserted');
    return problems;
  }

  const verifyIf = normalizeExpression(isPlainObject(verify) ? verify.if : undefined);
  for (const required of ['always()', "needs.publish.result=='skipped'", "needs.static.result=='success'"]) {
    if (!verifyIf.includes(required)) {
      problems.push(
        `verify-image.if must contain "${required}" so the anonymous-pull check still runs after a skipped publish but never after a failed one`,
      );
    }
  }
  if (verifyIf.includes("!='skipped'")) {
    problems.push(
      `verify-image.if must not contain "!= 'skipped'": that condition runs the verification when publish FAILED and skips it when publish was skipped -- the exact inversion this rule exists to catch`,
    );
  }

  const needs = asArray(isPlainObject(verify) ? verify.needs : undefined).map(String);
  for (const required of ['publish', 'static']) {
    if (!needs.includes(required)) {
      problems.push(`verify-image.needs must include "${required}" (needs the version output and the gate result), actual needs [${needs.join(', ') || '(none)'}]`);
    }
  }

  return problems;
}

/**
 * F12 -- every job starts with a checkout.
 *
 * Without it `context: '.'` is an empty directory: `scripts/ci/assert-image.sh`
 * and `apps/api/prisma/ENGINE_DECISION` simply do not exist, so the verification
 * step would fail for a reason unrelated to the image.
 *
 * The `tag` job additionally needs full history: a shallow clone does not fetch
 * tags, so `git rev-parse --verify refs/tags/X` cannot see a tag that already
 * exists remotely and the idempotency check silently degrades.
 *
 * @param {object|null} doc
 * @returns {string[]}
 */
export function checkJobsHaveCheckout(doc) {
  if (!isPlainObject(doc)) return [];

  const problems = [];
  for (const jobName of Object.keys(jobsOf(doc))) {
    const steps = stepsOf(doc, jobName);
    if (steps.length === 0) {
      problems.push(`job "${jobName}" has no steps, so it cannot begin with ${CHECKOUT}`);
      continue;
    }

    const first = steps[0];
    if (typeof first.uses !== 'string' || !first.uses.startsWith(CHECKOUT)) {
      problems.push(
        `job "${jobName}" must start with ${CHECKOUT} (its first step uses ${describe(first.uses)}); without a checkout the workspace is empty and every script path in this repository is missing`,
      );
      continue;
    }

    if (jobName === 'tag') {
      const withBlock = isPlainObject(first.with) ? first.with : null;
      const depth = withBlock === null ? undefined : withBlock['fetch-depth'];
      if (depth !== 0) {
        problems.push(
          `job "tag" must set with["fetch-depth"] = 0 (the number zero) on its checkout, got ${describe(depth)}; a shallow clone fetches no tags, so an existing remote tag cannot be detected and the idempotency check fails`,
        );
      }
    }
  }

  return problems;
}

/**
 * Runs every rule that applies to the requested profile.
 *
 * @param {{profile?: 'ci'|'release'|'all', cwd?: string}} [options]
 * @returns {{ok: boolean, profile: string, rules: number, problems: Array<{rule: string, detail: string}>}}
 */
export function validateWorkflows({ profile = 'all', cwd = process.cwd() } = {}) {
  const problems = [];
  const counter = { count: 0 };
  const add = (name, run) => {
    counter.count += 1;
    for (const detail of run() ?? []) problems.push({ rule: name, detail });
  };

  add('checkFiles', () => checkFiles(profile, cwd));

  const docs = {};
  for (const name of PROFILES[profile] ?? []) {
    let text;
    try {
      text = readFileSync(path.join(cwd, WORKFLOW_DIR, name), 'utf8');
    } catch {
      docs[name] = null; // checkFiles already reported this one
      continue;
    }
    try {
      docs[name] = yaml.load(text);
    } catch (error) {
      problems.push({
        rule: 'parse',
        detail: `${WORKFLOW_DIR}/${name} is not valid YAML (${firstLine(error.message)})`,
      });
      docs[name] = null;
    }
  }

  const ciDoc = docs['ci.yml'] ?? null;
  const releaseDoc = docs['release.yml'] ?? null;

  if (ciDoc !== null) {
    add('checkNoPrivilegedPrTrigger[ci]', () => checkNoPrivilegedPrTrigger(ciDoc));
    add('checkPermissions[ci]', () => checkPermissions(ciDoc, { packagesWrite: [], contentsWrite: [] }));
    add('checkPinnedActions[ci]', () => checkPinnedActions(ciDoc));
    add('checkJobGraph[ci]', () => checkJobGraph(ciDoc, EDGES.ci));
    add('checkCiGates', () => checkCiGates(ciDoc));
    add('checkJobsHaveCheckout[ci]', () => checkJobsHaveCheckout(ciDoc));
  }

  if (releaseDoc !== null) {
    add('checkNoPrivilegedPrTrigger[release]', () => checkNoPrivilegedPrTrigger(releaseDoc));
    add('checkDispatch', () => checkDispatch(releaseDoc));
    add('checkPermissions[release]', () =>
      checkPermissions(releaseDoc, { packagesWrite: ['publish'], contentsWrite: ['tag'] }),
    );
    add('checkPinnedActions[release]', () => checkPinnedActions(releaseDoc));
    add('checkJobGraph[release]', () => checkJobGraph(releaseDoc, EDGES.release));
    add('checkResumePath', () => checkResumePath(releaseDoc));
    add('checkBuildPushFlags', () => checkBuildPushFlags(releaseDoc, 'publish'));
    add('checkNoShellBuild', () => checkNoShellBuild(releaseDoc, 'publish'));
    add('checkStepRuns[guard]', () => checkStepRuns(releaseDoc, 'guard', GUARD_SNIPPETS));
    add('checkStepRuns[publish]', () => checkStepRuns(releaseDoc, 'publish', PUBLISH_SNIPPETS));
    add('checkStepRuns[verify-image]', () => checkStepRuns(releaseDoc, 'verify-image', VERIFY_IMAGE_SNIPPETS));
    add('checkStepRuns[tag]', () => checkStepRuns(releaseDoc, 'tag', TAG_SNIPPETS));
    add('checkJobsHaveCheckout[release]', () => checkJobsHaveCheckout(releaseDoc));
  }

  return { ok: problems.length === 0, profile, rules: counter.count, problems };
}

const USAGE = 'usage: node scripts/validate-workflows.mjs [--profile ci|release|all]';

/**
 * Parses CLI arguments. Throws on an unknown profile so a typo cannot fall back
 * to `all` and give a false sense of coverage.
 *
 * @param {string[]} argv
 * @returns {{profile: 'ci'|'release'|'all'}}
 */
export function parseArgs(argv = []) {
  let profile = 'all';
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--profile' || token.startsWith('--profile=')) {
      const value = token === '--profile' ? argv[index + 1] : token.slice('--profile='.length);
      if (value === undefined || value === '') throw new Error('--profile requires a value (ci|release|all)');
      if (!has(PROFILES, value)) {
        throw new Error(`--profile must be one of ${Object.keys(PROFILES).join('|')}, got "${value}"`);
      }
      profile = value;
      if (token === '--profile') index += 1;
      continue;
    }
    throw new Error(`unknown argument "${token}"`);
  }
  return { profile };
}

/**
 * CLI body. Prints every problem as `✗ <rule>: <detail>` and returns the exit
 * code -- 1 whenever anything failed, including a missing workflow file.
 *
 * @param {string[]} argv
 * @param {string} [cwd]
 * @returns {number}
 */
export function main(argv = [], cwd = process.cwd()) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.log(`✗ ${error.message}`);
    console.log(USAGE);
    return 2;
  }

  const result = validateWorkflows({ profile: args.profile, cwd });

  if (result.ok) {
    console.log(`✓ workflow checks passed (${result.rules} rules)`);
    return 0;
  }

  for (const problem of result.problems) console.log(`✗ ${problem.rule}: ${problem.detail}`);
  console.log(`${result.rules} rules run, ${result.problems.length} problem(s)`);
  return 1;
}

const isCliEntry =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntry) {
  process.exitCode = main(process.argv.slice(2));
}
