import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-workspace.mjs');

function withFixture(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), 'hw-lint-'));
  try {
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

function lint(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const GOOD_MJS = 'export const answer = 42;\n';
const GOOD_YAML = 'name: homeweave\nversion: 0.1.0\n';
const GOOD_JSON = '{"name":"x","private":true}\n';

test('legit workspace exits 0 and reports the file count', () => {
  withFixture(
    {
      'app.mjs': GOOD_MJS,
      'config.yaml': GOOD_YAML,
      'workflow.yml': 'on: push\njobs: {}\n',
      'package.json': GOOD_JSON,
    },
    (root) => {
      const result = lint(root);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /✓ lint passed \(4 files\)/);
    },
  );
});

test('broken JSON exits 1 and reports the file with a line number', () => {
  withFixture({ 'package.json': '{\n  "name": "x",\n}\n' }, (root) => {
    const result = lint(root);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /✗ package\.json: line 3:/);
    assert.match(result.stdout, /✗ lint failed \(1 problem\)/);
  });
});

test('broken YAML exits 1 and reports the file with a line number', () => {
  withFixture({ 'config.yml': 'name: [unclosed\n' }, (root) => {
    const result = lint(root);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /✗ config\.yml: line \d+:/);
  });
});

test('broken mjs syntax exits 1', () => {
  withFixture({ 'bad.mjs': 'export const = 1;\n' }, (root) => {
    const result = lint(root);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /✗ bad\.mjs:/);
  });
});

test('node_modules, dist and .planning are not scanned', () => {
  withFixture(
    {
      'app.mjs': GOOD_MJS,
      'node_modules/ignored/package.json': '{ not json',
      'dist/ignored.json': '{ not json',
      '.planning/ignored.yaml': 'a: [unclosed\n',
    },
    (root) => {
      const result = lint(root);
      assert.equal(result.code, 0, result.stdout);
      assert.match(result.stdout, /✓ lint passed \(1 files\)/);
    },
  );
});
