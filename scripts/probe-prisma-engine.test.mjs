import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NATIVE_ENGINE,
  NATIVE_MODULE_MANIFEST,
  RUST_FREE,
  RUST_FREE_SCOPE,
  checkDecision,
  checkNativeModuleManifest,
  isNativeEngineFile,
  probe,
  readGeneratorOutput,
  scanNativeModules,
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

// ---------------------------------------------------------------------------------------
// Second scan dimension: installed native modules (D-05a, threat T-03-03).
//
// The threat is not "a native module exists" -- better-sqlite3 is a deliberate part of the
// runtime. It is that `RUST_FREE` gets read as "no platform-specific binaries anywhere",
// so the addon's `.node` enters the image unexamined while the probe stays green. These
// cases pin the two dimensions apart: the Prisma-engine conclusion and the native-module
// inventory are asserted independently, so neither can silently answer for the other.
//
// None of the cases above are changed: their fixtures have no node_modules, and this
// file's contract is that those keep returning RUST_FREE.
// ---------------------------------------------------------------------------------------

/**
 * Create a directory link, preferring a Windows junction (needs no privilege) and falling
 * back to a plain directory symlink. Returns false when the environment refuses both, so
 * the caller can skip visibly instead of failing for an environment reason.
 */
function createDirectoryLink(target, linkPath) {
  for (const type of ['junction', 'dir']) {
    try {
      symlinkSync(target, linkPath, type);
      return true;
    } catch {
      // try the next strategy
    }
  }
  return false;
}

test('NATIVE_MODULES names better-sqlite3 while ENGINE_DECISION stays RUST_FREE', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      files: {
        'apps/api/src/generated/prisma/client.ts': 'export const PrismaClient = {};\n',
        'node_modules/better-sqlite3/package.json': '{ "name": "better-sqlite3", "version": "13.0.3" }\n',
        'node_modules/better-sqlite3/prebuilds/linux-x64.node': 'binary\n',
        'node_modules/better-sqlite3/prebuilds/linux-arm64.node': 'binary\n',
      },
    },
    (root) => {
      // Dimension 1: untouched. This is the assertion that keeps plan 02-03's
      // assert-image.sh contract alive while the semantics get narrowed.
      const checked = checkDecision({ root });
      assert.equal(checked.ok, true, checked.reason);
      assert.equal(checked.probe.decision, RUST_FREE);
      assert.equal(checked.reason, 'ok: RUST_FREE');

      // Dimension 2: the fact RUST_FREE never expressed.
      const natives = scanNativeModules({ root });
      assert.equal(natives.scanned, true);
      assert.deepEqual(natives.modules, ['better-sqlite3']);
      // Two prebuilds, one module: the report names packages, so a two-arch install does
      // not look like two dependencies.
      assert.equal(natives.files.length, 2);

      assert.equal(checkNativeModuleManifest({ root }).ok, true);
    },
  );
});

test('a native engine in the client dir does not leak into NATIVE_MODULES', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      files: {
        'apps/api/src/generated/prisma/client.ts': 'export const PrismaClient = {};\n',
        'apps/api/src/generated/prisma/libquery_engine-debian-openssl-3.0.x.so.node': 'binary\n',
      },
    },
    (root) => {
      // Old behaviour preserved: a native query engine still flips the decision.
      assert.equal(probe({ root }).decision, NATIVE_ENGINE);
      // And the independence in the other direction: the engine is not a "native module"
      // (it lives in the gitignored generated dir, not in node_modules).
      assert.deepEqual(scanNativeModules({ root }).modules, []);
    },
  );
});

test('NATIVE_MODULES is empty and the probe survives a tree with no node_modules', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      files: { 'apps/api/src/generated/prisma/client.ts': 'x\n' },
    },
    (root) => {
      const natives = scanNativeModules({ root });
      assert.equal(natives.scanned, false);
      assert.deepEqual(natives.modules, []);
      assert.deepEqual(natives.files, []);

      // "Never looked" is reported as a failed verification, not as a clean result --
      // the same rule probe() applies when the client dir is missing.
      const manifest = checkNativeModuleManifest({ root });
      assert.equal(manifest.ok, false);
      assert.match(manifest.reason, /node_modules not found/);

      // But it must not turn a bare checkout into a red CLI: the exit code still comes
      // from the Prisma dimension alone.
      const result = cli(root);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /^NATIVE_MODULES=$/m);
      assert.match(result.stdout, /^NATIVE_MODULES_SCANNED=false$/m);
      assert.match(result.stdout, new RegExp(`^RUST_FREE_SCOPE=${RUST_FREE_SCOPE}$`, 'm'));
      assert.match(result.stdout, new RegExp(`^ENGINE_DECISION=${RUST_FREE}$`, 'm'));
    },
  );
});

test('follows pnpm symlinks and reports each native module once', (t) => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      files: {
        'apps/api/src/generated/prisma/client.ts': 'x\n',
        'node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/package.json':
          '{ "name": "better-sqlite3", "version": "13.0.3" }\n',
        'node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/prebuilds/win32-x64.node': 'binary\n',
      },
    },
    (root) => {
      const storePackage = path.join(
        root,
        'node_modules',
        '.pnpm',
        'better-sqlite3@13.0.3',
        'node_modules',
        'better-sqlite3',
      );
      const linkPath = path.join(root, 'node_modules', 'better-sqlite3');
      if (!createDirectoryLink(storePackage, linkPath)) {
        t.skip('directory symlinks are not permitted in this environment');
        return;
      }

      const natives = scanNativeModules({ root });
      assert.deepEqual(natives.modules, ['better-sqlite3']);
      // The binary is reachable twice (through the store path and through the link).
      // One file reachable twice is one file; anything else means realpath de-duplication
      // is missing and the inventory over-counts.
      assert.equal(natives.files.length, 1, `expected 1 binary, got ${natives.files.length}: ${natives.files.join(', ')}`);
    },
  );
});

test('a native module outside the manifest fails the check and the CLI', () => {
  withFixture(
    {
      generatorOutput: '../src/generated/prisma',
      decision: 'RUST_FREE',
      files: {
        'apps/api/src/generated/prisma/client.ts': 'x\n',
        'node_modules/better-sqlite3/package.json': '{ "name": "better-sqlite3" }\n',
        'node_modules/better-sqlite3/prebuilds/linux-x64.node': 'binary\n',
        'node_modules/sharp/package.json': '{ "name": "sharp" }\n',
        'node_modules/sharp/build/Release/sharp.node': 'binary\n',
      },
    },
    (root) => {
      const manifest = checkNativeModuleManifest({ root });
      assert.equal(manifest.ok, false, manifest.reason);
      assert.deepEqual(manifest.unexpected, ['sharp']);

      // This is the false-green the case exists to make loud: the Prisma dimension is
      // perfectly happy while an undecided native dependency sits in the tree.
      assert.equal(checkDecision({ root }).ok, true);

      const result = cli(root);
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stdout, /^NATIVE_MODULES=better-sqlite3,sharp$/m);
      assert.match(result.stderr, /outside the manifest/);
    },
  );
});

test('the native module manifest is a non-empty array of package names', () => {
  // Guards the shape only: a string here would make manifest.includes() a substring test
  // and quietly accept anything containing "better-sqlite3".
  assert.ok(Array.isArray(NATIVE_MODULE_MANIFEST));
  assert.ok(NATIVE_MODULE_MANIFEST.length > 0);
  for (const name of NATIVE_MODULE_MANIFEST) {
    assert.match(name, /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, `not a package name: ${JSON.stringify(name)}`);
  }
});
