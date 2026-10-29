#!/usr/bin/env node
// Zero-dependency Dockerfile validator (IMG-05).
//
// Why this file exists: the production image is built in CI only -- this host has
// no Docker at all (`docker --version`, `docker buildx version`, `docker info` all
// fail with CommandNotFoundException, 02-RESEARCH.md §2). Without a static check,
// every rule in the Dockerfile is enforced by *nothing* until a CI run hours later,
// and the failure modes we care about (a leaked `COPY . .`, a `latest` base tag, a
// build-time secret passed through `ARG`/`ENV`, a root user) are exactly the ones
// that a reviewer's eye skips.
//
// Design contract:
//   - Zero dependencies: only `node:` builtins. `js-yaml` is NOT used here, because
//     a Dockerfile is not YAML and a parser would only add a failure surface.
//   - The rules live in one pure function, `validateDockerfile()`, so the tests can
//     feed it mutated strings without touching the real Dockerfile or the disk (plan
//     02-03 Task 4: "喂入临时字符串，不改真实 Dockerfile").
//   - Failures are collected, not thrown: one run lists every problem.
//   - Exit codes are only 0 (all checks passed) and 1 (at least one failed).
//
// Scope note: this validates STRUCTURE. It cannot prove the image builds, starts,
// or contains no secret -- those are `scripts/ci/assert-image.sh`, which is CI-only
// by construction (D-8 in 02-RESEARCH.md §七).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCKERFILE_FILE = 'Dockerfile';
export const DOCKERIGNORE_FILE = '.dockerignore';

/** The final stage must be named exactly this; the runtime assertions key off it. */
export const RUNTIME_STAGE = 'runtime';

/** Stages the runtime stage is required to copy from (plan 02-03 Task 4 rule 6). */
export const REQUIRED_COPY_SOURCES = ['build', 'prod-deps'];

/** Secret-ish identifiers that must never travel through ARG/ENV/COPY/ADD. */
const SECRET_NAME = /(?<![a-z0-9])(token|secret|password|private_key|api_key)(?![a-z0-9])/i;

/**
 * `.dockerignore` lines that MUST be present. The first four are the ones that
 * actually prevent a leak (02-RESEARCH.md §3.5); keeping them asserted here means
 * deleting one is a red build instead of a silent information-disclosure risk
 * (threat T-02-03).
 */
const REQUIRED_DOCKERIGNORE_ENTRIES = ['.env', '*.pem', '*.key', 'secrets'];

/**
 * Paths that must never be pruned from the build context. `prisma/migrations` is
 * shipped inside the image (the runtime COPYs `prisma/` from the build stage), so
 * an ignore rule matching it would remove the migration history from the artifact
 * while every other check stayed green.
 */
const PROTECTED_CONTEXT_PATHS = ['apps/api/prisma/migrations'];

/**
 * The runtime contract every production image must carry. `EXPOSE 8099` and
 * `CMD ["node","dist/main.js"]` are asserted here rather than left to review,
 * because plan 02-03 Task 1 list them as acceptance criteria -- a criterion that
 * only a human reads is a criterion that rots.
 */
const REQUIRED_RUNTIME_PORT = '8099';
const RUNTIME_CMD = /^CMD\s+\[\s*"node"\s*,\s*"dist\/main\.js"\s*\]$/i;

/**
 * Where the privilege-dropping entrypoint lands inside the runtime stage.
 *
 * 0.1.2 makes one root USER legal, because the Supervisor bind-mounts /data as
 * root:root and the server (uid 1000) cannot open the database until something
 * owns it. The waiver is not granted by a comment: the script is read and must
 * chown /data then exec gosu node. See `entrypointDropsPrivileges`.
 */
export const ENTRYPOINT_DEST = '/entrypoint.sh';

/**
 * Remove full-line `#` comments and join backslash continuations, so every later
 * rule sees one instruction per element.
 *
 * Only *whole-line* comments are removed: inside a Dockerfile a `#` that is not the
 * first non-whitespace character of a line is ordinary text (`ENV FOO=a#b`), and
 * stripping it would corrupt the instruction.
 */
export function logicalLines(text) {
  const result = [];
  let buffer = '';

  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (buffer === '' && (trimmed === '' || trimmed.startsWith('#'))) continue;

    const continued = line.trimEnd().endsWith('\\');
    const piece = continued ? line.trimEnd().slice(0, -1) : line;
    buffer = buffer === '' ? piece.trim() : `${buffer} ${piece.trim()}`;

    if (!continued) {
      result.push(buffer);
      buffer = '';
    }
  }

  if (buffer.trim() !== '') result.push(buffer);
  return result;
}

/** Split one `FROM` argument list into its image reference and optional alias. */
export function parseFrom(argument) {
  const tokens = argument.trim().split(/\s+/);
  const image = tokens[0] ?? '';
  const alias = tokens.length >= 3 && tokens[1].toUpperCase() === 'AS' ? tokens[2] : null;
  return { image, alias };
}

/** One entry per `FROM`: the stage's header plus every instruction that follows it. */
export function splitStages(text) {
  const stages = [];
  let current = null;

  for (const line of logicalLines(text)) {
    const match = /^FROM\s+(.+)$/i.exec(line);
    if (match) {
      const { image, alias } = parseFrom(match[1]);
      current = { image, alias, lines: [], index: stages.length };
      stages.push(current);
      continue;
    }
    if (current !== null) current.lines.push(line);
  }

  return stages;
}

/**
 * True when the reference carries an explicit tag.
 *
 * Only the last path segment is inspected, so a registry port
 * (`registry.example.com:5000/team/app:1.2.3`) is never mistaken for a tag and a
 * digest reference (`node@sha256:...`) is not read as `latest`.
 */
export function imageHasTag(reference) {
  if (reference.includes('@')) return true;
  const lastSegment = reference.split('/').pop() ?? '';
  return lastSegment.includes(':');
}

/** The tag of a reference, or null when untagged (digest references yield the digest). */
export function imageTag(reference) {
  if (reference.includes('@')) return reference.slice(reference.indexOf('@') + 1);
  const lastSegment = reference.split('/').pop() ?? '';
  const index = lastSegment.indexOf(':');
  return index === -1 ? null : lastSegment.slice(index + 1);
}

/** Instruction name of a logical line (`COPY`, `USER`, ...), upper-cased. */
function instruction(line) {
  const match = /^([A-Za-z]+)\b/.exec(line.trim());
  return match === null ? '' : match[1].toUpperCase();
}

/**
 * Sources of every `COPY`/`ADD` that writes to `destPath`, in file order.
 *
 * Used to find which script in the repository actually becomes
 * `ENTRYPOINT_DEST`, instead of assuming a path and quietly reading a stale file
 * after someone moves it.
 */
export function copySourcesFor(dockerfileText, destPath) {
  const sources = [];

  for (const line of logicalLines(dockerfileText ?? '')) {
    const name = instruction(line);
    if (name !== 'COPY' && name !== 'ADD') continue;

    // Drop flags (`--chmod=755`, `--from=build`); what remains is src... dest.
    const tokens = line.trim().split(/\s+/).slice(1).filter((token) => !token.startsWith('--'));
    if (tokens.length < 2) continue;
    if (tokens[tokens.length - 1] !== destPath) continue;

    sources.push(...tokens.slice(0, -1));
  }

  return sources;
}

/**
 * True when the entrypoint script provably drops privileges.
 *
 * Both halves are required, and both are read from the script's text:
 *   - `chown -R node:node /data` — the ownership fix that makes 0.1.1's exit 78
 *     impossible, and the reason a root USER is tolerated at all;
 *   - `exec gosu node "$@"` — the drop itself. `exec` matters: without it the shell
 *     stays as PID 1, which intercepts SIGTERM and breaks the drain budget.
 *
 * A script that merely mentions gosu, or hard-codes the command instead of passing
 * `"$@"`, does not satisfy this.
 */
export function entrypointDropsPrivileges(source) {
  if (typeof source !== 'string' || source.trim() === '') return false;

  const chowns = /\bchown\s+-R\s+node:node\s+\/data\b/.test(source);
  const drops = /exec\s+gosu\s+node\s+"\$@"/.test(source);

  return chowns && drops;
}

/**
 * Translate one `.dockerignore` glob into a RegExp.
 *
 * `*` never crosses a `/`, `?` matches one non-`/` character, and `**` (with or
 * without a following slash) matches across separators. Docker's own matcher has
 * more corners than this, but the only question asked here is "could this line
 * prune a path we require", and answering that conservatively is the point.
 */
function globToRegExp(glob) {
  let source = '';

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') index += 1;
        source += '.*';
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`);
}

/**
 * True when a `.dockerignore` line would prune `target` (or any directory on the
 * way to it) out of the build context.
 *
 * Every ancestor prefix is tested, because ignoring a directory removes everything
 * beneath it: a `.dockerignore` line of `prisma` loses
 * `apps/api/prisma/migrations` even though the migration path is never named.
 */
export function ignoresPath(ignoreLine, target) {
  const line = ignoreLine.trim();
  if (line === '' || line.startsWith('#')) return false;
  // A negated pattern re-includes a path; it can never be the reason a path is gone.
  if (line.startsWith('!')) return false;

  const pattern = line.replace(/^\/+/, '').replace(/\/+$/, '');
  if (pattern === '') return false;

  const segments = target.split('/');
  const prefixes = new Set();
  for (let index = 1; index <= segments.length; index += 1) {
    prefixes.add(segments.slice(0, index).join('/'));
  }
  // The runtime COPY uses the short form `prisma/migrations`, so a pattern that
  // only matches that suffix must be caught too.
  for (let index = 2; index <= segments.length; index += 1) {
    prefixes.add(segments.slice(-index).join('/'));
  }
  // A pattern with no separator matches a basename at any depth, so a bare
  // `prisma` line removes every directory named prisma -- including this one.
  if (!pattern.includes('/')) {
    for (const segment of segments) prefixes.add(segment);
  }

  const regex = globToRegExp(pattern);
  return [...prefixes].some((prefix) => regex.test(prefix));
}

/**
 * Run every rule against the two input texts.
 *
 * Returns `{ ok, checks, failures }`; `failures` entries are `{ code, message }`
 * so the CLI and the tests share one rule set and one wording.
 */
export function validateDockerfile({ dockerfileText, dockerignoreText = null, entrypointSource = null } = {}) {
  const failures = [];
  let checks = 0;

  const check = (ok, code, message) => {
    checks += 1;
    if (!ok) failures.push({ code, message });
    return ok;
  };

  const stages = splitStages(dockerfileText ?? '');
  const aliases = new Set(stages.map((stage) => stage.alias).filter(Boolean));

  // D1 -- multi-stage, and the last stage is the runtime stage.
  check(stages.length >= 3, 'D1', `expected at least 3 build stages, found ${stages.length}`);
  const finalStage = stages.length > 0 ? stages[stages.length - 1] : null;
  check(
    finalStage !== null && finalStage.alias === RUNTIME_STAGE,
    'D1',
    `the last stage must be \`AS ${RUNTIME_STAGE}\`, found ${finalStage === null ? 'no stage at all' : `\`${finalStage.image}${finalStage.alias === null ? '' : ` AS ${finalStage.alias}`}\``}`,
  );

  const runtimeLines = finalStage === null ? [] : finalStage.lines;

  // D2 -- the runtime stage runs as a non-root user.
  //
  // One exception, added in 0.1.2: Supervisor bind-mounts /data as root:root, so a
  // fresh install cannot write its database as uid 1000 (0.1.1 died with exit 78).
  // A root USER is legal only alongside an ENTRYPOINT whose script is READ HERE and
  // proves it chowns /data then execs gosu node. The waiver is about the code, not
  // about a comment claiming it, and it is the only door.
  const userInstructions = runtimeLines
    .filter((line) => instruction(line) === 'USER')
    .map((line) => line.trim().split(/\s+/)[1] ?? '');
  check(
    userInstructions.length > 0,
    'D2',
    `the ${RUNTIME_STAGE} stage has no USER instruction, so the container runs as root`,
  );
  const finalUser = userInstructions.length > 0 ? userInstructions[userInstructions.length - 1] : null;
  const rootUser = finalUser === null || finalUser === 'root' || finalUser === '0';
  const entrypoints = runtimeLines.filter((line) => instruction(line) === 'ENTRYPOINT');
  check(
    !rootUser || (entrypoints.length === 1 && entrypointDropsPrivileges(entrypointSource)),
    'D2',
    `the ${RUNTIME_STAGE} stage must run as a non-root user, found USER ${finalUser ?? '(none)'}; root is allowed only with an ENTRYPOINT that chowns /data and execs gosu node (entrypoints=${entrypoints.length}, script=${entrypointSource === null ? 'not readable' : 'does not drop privileges'})`,
  );

  // D3 -- the runtime stage never copies the whole build context.
  const contextCopies = runtimeLines.filter((line) => {
    const name = instruction(line);
    if (name !== 'COPY' && name !== 'ADD') return false;
    const parts = line.trim().split(/\s+/).slice(1).filter((part) => !part.startsWith('--'));
    const source = parts[0] ?? '';
    return source === '.' || source === './';
  });
  check(
    contextCopies.length === 0,
    'D3',
    `the ${RUNTIME_STAGE} stage must not copy the whole build context (found: ${contextCopies.map((line) => line.trim()).join('; ') || 'none'})`,
  );

  // D4 -- every base image is tagged and none of them is `latest`.
  for (const stage of stages) {
    // A `FROM <stage-name>` inherits an already-validated reference.
    if (aliases.has(stage.image)) continue;
    check(
      imageHasTag(stage.image),
      'D4',
      `base image "${stage.image}" has no tag; an untagged reference means \`latest\``,
    );
    const tag = imageTag(stage.image);
    check(
      tag === null || tag.toLowerCase() !== 'latest',
      'D4',
      `base image "${stage.image}" uses the \`latest\` tag; pin a version so a rebuild is reproducible`,
    );
  }

  // D5 -- no build-time secret travels through ARG/ENV/COPY/ADD.
  const secretBearing = logicalLines(dockerfileText ?? '').filter((line) => {
    const name = instruction(line);
    if (name !== 'ARG' && name !== 'ENV' && name !== 'COPY' && name !== 'ADD') return false;
    return SECRET_NAME.test(line);
  });
  check(
    secretBearing.length === 0,
    'D5',
    `build-time secrets must use \`RUN --mount=type=secret\`, never ARG/ENV/COPY (found: ${secretBearing.map((line) => line.trim()).join('; ') || 'none'})`,
  );

  // D6 -- the runtime stage really consumes the build and prod-deps stages.
  for (const source of REQUIRED_COPY_SOURCES) {
    const pattern = new RegExp(`^COPY\\s+.*--from=${source}(\\s|$)`, 'i');
    const present = logicalLines(dockerfileText ?? '').some((line) => pattern.test(line.trim()));
    check(
      present,
      'D6',
      `no \`COPY --from=${source}\` instruction: the ${source} stage would be built and then discarded`,
    );
  }

  // D7 -- `.dockerignore` exists and keeps the leak guards, without pruning migrations.
  const ignoreText2 = dockerignoreText;
  check(ignoreText2 !== null, 'D7', `${DOCKERIGNORE_FILE} is missing; the build context would include .env, .git and dist`);
  const ignoreLines = ignoreText2 === null ? [] : String(ignoreText2).split(/\r?\n/);
  for (const entry of REQUIRED_DOCKERIGNORE_ENTRIES) {
    check(
      ignoreLines.some((line) => line.trim() === entry),
      'D7',
      `${DOCKERIGNORE_FILE} must contain the line "${entry}" (leak guard, threat T-02-03)`,
    );
  }
  for (const target of PROTECTED_CONTEXT_PATHS) {
    const offender = ignoreLines.find((line) => ignoresPath(line, target));
    check(
      offender === undefined,
      'D7',
      `${DOCKERIGNORE_FILE} prunes "${target}" ("${offender ?? ''}"); the image must ship prisma/migrations`,
    );
  }

  // D8 -- the runtime contract: documented port and entrypoint.
  const expose = runtimeLines
    .filter((line) => instruction(line) === 'EXPOSE')
    .flatMap((line) => line.trim().split(/\s+/).slice(1));
  check(
    expose.includes(REQUIRED_RUNTIME_PORT),
    'D8',
    `the ${RUNTIME_STAGE} stage must EXPOSE ${REQUIRED_RUNTIME_PORT} (homeweave_app/config.yaml ingress_port), found ${expose.join(' ') || '(none)'}`,
  );
  const cmds = runtimeLines.filter((line) => instruction(line) === 'CMD');
  check(
    cmds.length === 1 && RUNTIME_CMD.test(cmds[0].trim()),
    'D8',
    `the ${RUNTIME_STAGE} stage must end with CMD ["node","dist/main.js"], found ${cmds.map((line) => line.trim()).join('; ') || '(none)'}`,
  );

  // D9 -- no HEALTHCHECK while the app has no HTTP endpoint (D-7). A healthcheck
  // against a route that does not exist makes the container permanently unhealthy,
  // which is worse than no healthcheck: Supervisor would report a running app as
  // broken. Phase 3 adds /health and this rule is removed with it.
  const healthchecks = logicalLines(dockerfileText ?? '').filter(
    (line) => instruction(line) === 'HEALTHCHECK',
  );
  check(
    healthchecks.length === 0,
    'D9',
    `no HEALTHCHECK may be declared yet: the API has no HTTP endpoint until Phase 3, so the container would report unhealthy forever (D-7). Found: ${healthchecks.map((line) => line.trim()).join('; ')}`,
  );

  // D10 -- no VOLUME directive. `/data` is bind-mounted explicitly by the Home
  // Assistant App; declaring VOLUME would additionally create an anonymous volume
  // that Supervisor never backs up.
  const volumes = logicalLines(dockerfileText ?? '').filter((line) => instruction(line) === 'VOLUME');
  check(
    volumes.length === 0,
    'D10',
    `no VOLUME directive: /data is mounted by Supervisor, and a declared volume would create an anonymous, unbacked one. Found: ${volumes.map((line) => line.trim()).join('; ')}`,
  );

  return { ok: failures.length === 0, checks, failures, stages };
}

/**
 * Read the script that becomes `ENTRYPOINT_DEST`, following the Dockerfile's own
 * COPY instead of a hard-coded path -- a comment saying "this is the entrypoint"
 * cannot drift away from the file that is actually copied in.
 *
 * Returns null when the Dockerfile copies no such script, or the file is missing:
 * D2 then reports "not readable" rather than passing by default.
 */
export function readEntrypointSource(root, dockerfileText) {
  const sources = copySourcesFor(dockerfileText, ENTRYPOINT_DEST);
  if (sources.length === 0) return null;

  try {
    return readFileSync(path.join(root, sources[sources.length - 1]), 'utf8');
  } catch {
    return null;
  }
}

/** Read the files the validator owns, tolerating a missing `.dockerignore` or entrypoint. */
export function readInputs(root = process.cwd()) {
  const dockerfilePath = path.join(root, DOCKERFILE_FILE);
  const dockerignorePath = path.join(root, DOCKERIGNORE_FILE);

  const dockerfileText = readFileSync(dockerfilePath, 'utf8');

  let dockerignoreText = null;
  try {
    dockerignoreText = readFileSync(dockerignorePath, 'utf8');
  } catch {
    dockerignoreText = null;
  }

  return { dockerfileText, dockerignoreText, entrypointSource: readEntrypointSource(root, dockerfileText) };
}

/** Human-readable failure lines, shared by the CLI and the tests. */
export function formatFailures(failures) {
  return failures.map((failure) => `✗ ${failure.code}: ${failure.message}`);
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
  let inputs;
  try {
    inputs = readInputs(parseRoot(process.argv));
  } catch (error) {
    console.log(`✗ D0: cannot read ${DOCKERFILE_FILE} (${error.code || error.message})`);
    process.exitCode = 1;
  }

  if (inputs !== undefined) {
    const result = validateDockerfile(inputs);
    for (const line of formatFailures(result.failures)) console.log(line);
    if (result.ok) {
      console.log(`✓ dockerfile checks passed (${result.checks} rules)`);
    } else {
      console.log(`${result.checks} checks run, ${result.failures.length} failed`);
      process.exitCode = 1;
    }
  }
}
