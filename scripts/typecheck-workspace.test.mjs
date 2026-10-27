import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'typecheck-workspace.mjs');

const WORKSPACE_YAML = 'packages:\n  - "apps/*"\n';
const ROOT_MANIFEST = '{"name":"fixture-root","private":true}\n';

function withFixture(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), 'hw-typecheck-'));
  try {
    writeFileSync(path.join(root, 'package.json'), ROOT_MANIFEST, 'utf8');
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), WORKSPACE_YAML, 'utf8');
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, 'utf8');
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function typecheck(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('refuses to pass when no package declares typecheck', () => {
  withFixture(
    { 'apps/api/package.json': '{"name":"@t/api","version":"0.0.0"}\n' },
    (root) => {
      const result = typecheck(root);
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stdout, /✗ no workspace package declares typecheck/);
    },
  );
});

test('forwards exit 0 when the declaring package typecheck passes', () => {
  withFixture(
    {
      'apps/ok/package.json': '{"name":"@t/ok","scripts":{"typecheck":"node check.mjs"}}\n',
      'apps/ok/check.mjs': 'process.exit(0);\n',
    },
    (root) => {
      const result = typecheck(root);
      assert.equal(result.code, 0, result.stdout);
      assert.match(result.stdout, /✓ typecheck passed \(@t\/ok\)/);
    },
  );
});

test('forwards the failure exit code when the package typecheck fails', () => {
  withFixture(
    {
      'apps/bad/package.json': '{"name":"@t/bad","scripts":{"typecheck":"node check.mjs"}}\n',
      'apps/bad/check.mjs': 'process.exit(2);\n',
    },
    (root) => {
      const result = typecheck(root);
      assert.notEqual(result.code, 0, result.stdout);
      assert.match(result.stdout, /✗ typecheck failed/);
    },
  );
});

test('ignores package directories without a package.json', () => {
  withFixture(
    { 'apps/empty/README.md': 'placeholder\n' },
    (root) => {
      const result = typecheck(root);
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stdout, /✗ no workspace package declares typecheck/);
    },
  );
});
