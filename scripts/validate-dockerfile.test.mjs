import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ignoresPath,
  logicalLines,
  readInputs,
  validateDockerfile,
} from './validate-dockerfile.mjs';

/** Repository root: this test file lives in `scripts/`. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A minimal Dockerfile that satisfies every rule. Each defect case below mutates
 * exactly one aspect of this string, so a failure can only come from the rule the
 * test names -- never from an unrelated slip in the fixture.
 *
 * Deliberately NOT read from the repository's real `Dockerfile`: the point of these
 * cases is that the rules can go red, and a test bound to the real file would go red
 * with it (plan 02-03 Task 4: "喂入临时字符串，不改真实 Dockerfile").
 */
const GOOD = [
  'FROM node:22-bookworm-slim AS base',
  'WORKDIR /app',
  '',
  'FROM base AS build',
  'COPY . .',
  'RUN echo build',
  '',
  'FROM base AS prod-deps',
  'RUN echo prod',
  '',
  'FROM node:22-bookworm-slim AS runtime',
  'ENV NODE_ENV=production',
  'WORKDIR /app',
  'COPY --from=build /app/apps/api/dist ./dist',
  'COPY --from=prod-deps /prod/node_modules ./node_modules',
  'USER node',
  'EXPOSE 8099',
  'CMD ["node","dist/main.js"]',
  '',
].join('\n');

const GOOD_IGNORE = [
  'node_modules',
  '**/dist',
  '.git',
  '.planning',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'secrets',
  '',
].join('\n');

function run(dockerfileText, dockerignoreText = GOOD_IGNORE, entrypointSource = null) {
  return validateDockerfile({ dockerfileText, dockerignoreText, entrypointSource });
}

/** All failure codes, for readable assertions. */
function codes(result) {
  return result.failures.map((failure) => failure.code);
}

test('a well-formed Dockerfile passes every rule', () => {
  const result = run(GOOD);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.ok(result.checks >= 10, `expected at least 10 checks, got ${result.checks}`);
  assert.equal(result.stages.length, 4);
});

test('D1: fewer than three stages fails', () => {
  const twoStages = [
    'FROM node:22-bookworm-slim AS base',
    'RUN echo base',
    '',
    'FROM node:22-bookworm-slim AS runtime',
    'USER node',
    'EXPOSE 8099',
    'CMD ["node","dist/main.js"]',
    '',
  ].join('\n');

  const result = run(twoStages);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D1'));
  assert.match(result.failures.find((f) => f.code === 'D1').message, /at least 3 build stages/);
});

test('D1: a last stage that is not named runtime fails', () => {
  const result = run(GOOD.replace('FROM node:22-bookworm-slim AS runtime', 'FROM node:22-bookworm-slim AS final'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D1'));
  assert.match(result.failures[0].message, /AS runtime/);
});

test('D2: a runtime stage without USER fails', () => {
  const result = run(GOOD.replace('USER node\n', ''));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D2'));
  assert.match(result.failures.find((f) => f.code === 'D2').message, /runs as root/);
});

test('D2: USER root fails even though a USER instruction exists', () => {
  const result = run(GOOD.replace('USER node', 'USER root'));
  assert.equal(result.ok, false);
  const failures = result.failures.filter((f) => f.code === 'D2');
  assert.equal(failures.length, 1, 'the missing-USER check must not also fire');
  assert.match(failures[0].message, /non-root user/);
});

// 0.1.2 -- the single root USER this image carries. It exists because Supervisor
// bind-mounts /data as root:root; the waiver is granted to the *script*, which is
// read and must chown /data then exec gosu node. Both directions are locked here:
// without these, "root is allowed when the entrypoint drops privileges" would be a
// claim nobody verifies.
const ROOTED = GOOD.replace('USER node', 'USER root\nENTRYPOINT ["/entrypoint.sh"]');
const DROPPING_SCRIPT = '#!/bin/sh\nchown -R node:node /data\nexec gosu node "$@"\n';

test('D2: a root USER passes when the entrypoint chowns /data and execs gosu node', () => {
  const result = run(ROOTED, GOOD_IGNORE, DROPPING_SCRIPT);
  assert.deepEqual(codes(result), []);
});

test('D2: a root USER still fails when the script chowns but never drops privileges', () => {
  const result = run(ROOTED, GOOD_IGNORE, '#!/bin/sh\nchown -R node:node /data\nexec node "$@"\n');
  assert.deepEqual(codes(result), ['D2']);
  assert.match(result.failures[0].message, /does not drop privileges/);
});

test('D2: an ENTRYPOINT whose script cannot be read does not qualify', () => {
  const result = run(ROOTED);
  assert.deepEqual(codes(result), ['D2']);
  assert.match(result.failures[0].message, /not readable/);
});

test('D3: copying the whole build context into the runtime stage fails', () => {
  const result = run(GOOD.replace('COPY --from=build /app/apps/api/dist ./dist', 'COPY --from=build /app/apps/api/dist ./dist\nCOPY . .'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D3'));
  assert.match(result.failures.find((f) => f.code === 'D3').message, /whole build context/);
});

test('D3: ADD . . is rejected the same way as COPY . .', () => {
  const result = run(GOOD.replace('USER node', 'ADD . .\nUSER node'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D3'));
});

test('D4: an untagged base image fails', () => {
  const result = run(GOOD.replace('FROM node:22-bookworm-slim AS runtime', 'FROM node AS runtime'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D4'));
  assert.match(result.failures.find((f) => f.code === 'D4').message, /has no tag/);
});

test('D4: the latest tag fails', () => {
  const result = run(GOOD.replace('FROM node:22-bookworm-slim AS runtime', 'FROM node:latest AS runtime'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D4'));
  assert.match(result.failures.find((f) => f.code === 'D4').message, /`latest` tag/);
});

test('D4: a stage alias used as a base is not treated as an untagged image', () => {
  const result = run(GOOD);
  assert.equal(result.ok, true, 'FROM base AS build must not be read as an image without a tag');
});

test('D5: a secret passed through ARG fails', () => {
  const result = run(GOOD.replace('WORKDIR /app\n\nFROM base AS build', 'ARG NPM_TOKEN\nWORKDIR /app\n\nFROM base AS build'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D5'));
  assert.match(result.failures.find((f) => f.code === 'D5').message, /--mount=type=secret/);
});

test('D5: a secret passed through ENV fails', () => {
  const result = run(GOOD.replace('ENV NODE_ENV=production', 'ENV NODE_ENV=production\nENV GITHUB_TOKEN=abc'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D5'));
});

test('D5: a secret COPY source fails', () => {
  const result = run(GOOD.replace('COPY --from=build /app/apps/api/dist ./dist', 'COPY --from=build /app/apps/api/dist ./dist\nCOPY secrets/api_key ./api_key'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D5'));
});

test('D5: prose in a comment is not mistaken for a secret argument', () => {
  const result = run(GOOD.replace('WORKDIR /app\n\nFROM base AS build', '# never pass a token or password here\nWORKDIR /app\n\nFROM base AS build'));
  assert.equal(result.ok, true);
});

test('D6: a missing COPY --from=prod-deps fails', () => {
  const result = run(GOOD.replace('COPY --from=prod-deps /prod/node_modules ./node_modules\n', ''));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D6'));
  assert.match(result.failures.find((f) => f.code === 'D6').message, /--from=prod-deps/);
});

test('D6: a missing COPY --from=build fails', () => {
  const result = run(GOOD.replace('COPY --from=build /app/apps/api/dist ./dist\n', ''));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D6'));
});

test('D7: a missing .dockerignore fails', () => {
  const result = run(GOOD, null);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D7'));
  assert.match(result.failures.find((f) => f.code === 'D7').message, /is missing/);
});

test('D7: each required leak-guard line is asserted individually', () => {
  for (const entry of ['*.pem', '*.key', 'secrets']) {
    const ignore = GOOD_IGNORE.split('\n').filter((line) => line !== entry).join('\n');
    const result = run(GOOD, ignore);
    assert.equal(result.ok, false, `dropping "${entry}" must fail`);
    const d7 = result.failures.filter((failure) => failure.code === 'D7');
    assert.equal(d7.length, 1, `exactly one D7 failure expected for "${entry}"`);
    assert.ok(
      d7[0].message.includes(`"${entry}"`),
      `failure message must name "${entry}", got: ${d7[0].message}`,
    );
  }
});

test('D7: ignoring the whole prisma directory fails', () => {
  const result = run(GOOD, `${GOOD_IGNORE}\nprisma\n`);
  assert.equal(result.ok, false);
  assert.match(result.failures.find((f) => f.code === 'D7').message, /prunes "apps\/api\/prisma\/migrations"/);
});

test('D7: an explicit migrations ignore rule fails', () => {
  const result = run(GOOD, `${GOOD_IGNORE}\napps/api/prisma/migrations\n`);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D7'));
});

test('D7: a negated rule never counts as pruning a path', () => {
  assert.equal(ignoresPath('!apps/api/prisma/migrations', 'apps/api/prisma/migrations'), false);
  assert.equal(ignoresPath('node_modules', 'apps/api/prisma/migrations'), false);
  assert.equal(ignoresPath('**/dist', 'apps/api/prisma/migrations'), false);
  assert.equal(ignoresPath('**/prisma', 'apps/api/prisma/migrations'), true);
});

test('D8: a wrong EXPOSE port fails', () => {
  const result = run(GOOD.replace('EXPOSE 8099', 'EXPOSE 3000'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D8'));
  assert.match(result.failures.find((f) => f.code === 'D8').message, /EXPOSE 8099/);
});

test('D8: a missing CMD fails', () => {
  const result = run(GOOD.replace('CMD ["node","dist/main.js"]\n', ''));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D8'));
});

test('D9: a HEALTHCHECK fails while the API has no HTTP endpoint', () => {
  const result = run(GOOD.replace('USER node', 'HEALTHCHECK CMD wget -qO- http://localhost:8099/ || exit 1\nUSER node'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D9'));
  assert.match(result.failures.find((f) => f.code === 'D9').message, /no HTTP endpoint until Phase 3/);
});

test('D10: a VOLUME directive fails', () => {
  const result = run(GOOD.replace('USER node', 'VOLUME /data\nUSER node'));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('D10'));
});

// The real artifacts are asserted too, so the rules cannot quietly drift away from
// the file they exist to protect. This case reads the repository's own Dockerfile and
// .dockerignore; the defect cases above stay on temp strings and never touch them.
test('the repository Dockerfile and .dockerignore pass every rule', () => {
  const result = validateDockerfile(readInputs(REPO_ROOT));
  assert.deepEqual(
    result.failures.map((failure) => `${failure.code}: ${failure.message}`),
    [],
  );
  assert.equal(result.ok, true);
});

test('logicalLines drops full-line comments and joins continuations', () => {
  const lines = logicalLines(['# leading comment', 'RUN apt-get update \\', ' && apt-get install -y curl', 'ENV A=b#c'].join('\n'));
  assert.deepEqual(lines, ['RUN apt-get update && apt-get install -y curl', 'ENV A=b#c']);
});
