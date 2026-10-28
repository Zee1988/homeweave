import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NATIVE_ENGINE,
  RUST_FREE,
  checkDecision,
  isNativeEngineFile,
  probe,
  readGeneratorOutput,
  stripComments,
} from './probe-prisma-engine.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe-prisma-engine.mjs');
const SCHEMA_PATH = 'apps/api/prisma/schema.prisma';

/**
 * Builds a throwaway repo-shaped fixture. `output` mimics the real schema: an
 * `output` value relative to the schema file, which is what the probe must
 * resolve against -- the whole point of the regression this file guards.
 */
function withFixture({ generatorOutput, decision, files = {}, schemaExtra = '' }, run) {
  const root = mkdtempSync(path.join(tmpdir(), 'hw-probe-'));
  try {
    const entries = { ...files };
    const outputLine = generatorOutput === undefined ? '' : `  output   = "${generatorOutput}"\n`;
    const generator = `generator client {\n  provider = "prisma-client"\n${outputLine}${schemaExtra}}\n`;

    entries[SCHEMA_PATH] = [
      'datasource db {\n  provider = "sqlite"\n}\n',
      generator,
      'model AppSetting {\n  key String @id\n}\n',
    ].join('\n');

    if (decision !== undefined) {
      entries['apps/api/prisma/ENGINE_DECISION'] = decision;
    }

    for (const [relativePath, content] of Object.entries(entries)) {
      const absolutePath = path.join(root, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, 'utf8');
    }

    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function cli(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('resolves the generator output relative to the schema file, not the repo root', () => {
  withFixture({ generatorOutput: '../src/generated/prisma' }, (root) => {
    assert.equal(
      readGeneratorOutput(path.join(root, SCHEMA_PATH)),
      path.join(root, 'apps/api/src/generated/prisma'),
    );
  });
});

test('reports RUST_FREE for a generated client without native binaries', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      files: {
        'apps/api/src/generated/prisma/client.ts': 'export const PrismaClient = {};\n',
        'apps/api/src/generated/prisma/models/AppSetting.ts': 'export type AppSetting = {};\n',
      },
    },
    (root) => {
      const result = probe({ root });
      assert.equal(result.decision, RUST_FREE);
      assert.equal(result.fileCount, 2);
      assert.deepEqual(result.nativeFiles, []);
    },
  );
});

test('reports NATIVE_ENGINE when a native query engine binary is present', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      files: {
        'apps/api/src/generated/prisma/client.ts': 'export const PrismaClient = {};\n',
        'apps/api/src/generated/prisma/libquery_engine-debian-openssl-3.0.x.so.node': 'binary\n',
      },
    },
    (root) => {
      const result = probe({ root });
      assert.equal(result.decision, NATIVE_ENGINE);
      assert.deepEqual(result.nativeFiles, ['libquery_engine-debian-openssl-3.0.x.so.node']);
    },
  );
});

test('never claims RUST_FREE when no generated client directory exists', () => {
  withFixture({ generatorOutput: '../src/generated/prisma' }, (root) => {
    const result = probe({ root });
    assert.equal(result.decision, null);
    assert.equal(result.dir, null);

    const checked = checkDecision({ root });
    assert.equal(checked.ok, false);
    assert.match(checked.reason, /generated client dir not found/);
  });
});

test('fails when ENGINE_DECISION is missing', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const checked = checkDecision({ root });
      assert.equal(checked.ok, false);
      assert.match(checked.reason, /ENGINE_DECISION missing/);
    },
  );
});

test('fails when ENGINE_DECISION disagrees with the probe', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'NATIVE_ENGINE',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const checked = checkDecision({ root });
      assert.equal(checked.ok, false);
      assert.match(checked.reason, /ENGINE_DECISION mismatch: file=NATIVE_ENGINE probe=RUST_FREE/);
    },
  );
});

test('fails when ENGINE_DECISION is not one of the two legal values', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'MAYBE\n',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const checked = checkDecision({ root });
      assert.equal(checked.ok, false);
      assert.match(checked.reason, /invalid ENGINE_DECISION/);
    },
  );
});

test('fails when a RUST_FREE conclusion leaves binaryTargets in the schema', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      schemaExtra: '  binaryTargets = ["native"]\n',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const checked = checkDecision({ root });
      assert.equal(checked.ok, false);
      assert.match(checked.reason, /still declares binaryTargets/);
    },
  );
});

test('ignores binaryTargets mentioned only in comments', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      schemaExtra: '  // binaryTargets is intentionally absent (RUST_FREE)\n',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const checked = checkDecision({ root });
      assert.equal(checked.ok, true, checked.reason);
    },
  );
});

test('stripComments removes line and block comments only', () => {
  const stripped = stripComments('a // tail\n/* whole\nline */\nb\n');
  assert.equal(stripped, 'a\n\nb\n');
});

test('accepts a consistent RUST_FREE decision, trimming the trailing newline', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE\n',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const checked = checkDecision({ root });
      assert.equal(checked.ok, true, checked.reason);
      assert.equal(checked.reason, 'ok: RUST_FREE');
    },
  );
});

test('treats .node extension and query-engine prefixes as native markers', () => {
  assert.equal(isNativeEngineFile('/x/libquery_engine-linux-arm64-openssl-3.0.x.so.node'), true);
  assert.equal(isNativeEngineFile('/x/query_engine-windows.dll.node'), true);
  assert.equal(isNativeEngineFile('/x/query-engine.exe'), true);
  assert.equal(isNativeEngineFile('/x/client.ts'), false);
  assert.equal(isNativeEngineFile('/x/runtime/wasm-compiler-edge.js'), false);
});

test('CLI exits 1 and prints the mismatch reason', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'NATIVE_ENGINE',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const result = cli(root);
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stdout, /native binaries: 0/);
      assert.match(result.stdout, /ENGINE_DECISION mismatch/);
    },
  );
});

test('CLI exits 0 for a consistent decision', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const result = cli(root);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ok: RUST_FREE/);
    },
  );
});
