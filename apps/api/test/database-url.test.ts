import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DATABASE_URL,
  databasePathFromUrl,
  resolveDatabaseUrl,
} from '../src/config/database-url.ts';

test('falls back to the container default when DATABASE_URL is absent', () => {
  assert.equal(resolveDatabaseUrl({}), DEFAULT_DATABASE_URL);
  assert.equal(DEFAULT_DATABASE_URL, 'file:/data/homeweave.db');
});

test('treats an empty or whitespace-only DATABASE_URL as absent', () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: '' }), DEFAULT_DATABASE_URL);
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: '   ' }), DEFAULT_DATABASE_URL);
});

test('passes an absolute container URL through untouched', () => {
  // The `file:` prefix must survive: the driver adapter strips it itself, and a
  // pre-stripped value would make /data/homeweave.db a relative path.
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: 'file:/data/homeweave.db' }), 'file:/data/homeweave.db');
  assert.equal(databasePathFromUrl('file:/data/homeweave.db'), '/data/homeweave.db');
});

test('resolves a relative local-dev URL against the working directory, unchanged', () => {
  const url = resolveDatabaseUrl({ DATABASE_URL: 'file:./data/app.db' });
  assert.equal(url, 'file:./data/app.db');
  assert.equal(databasePathFromUrl(url), './data/app.db');
});

test('strips exactly one leading file: prefix', () => {
  assert.equal(databasePathFromUrl('file:.tmp/dev.db'), '.tmp/dev.db');
  // An in-memory database has no filesystem path; only the `file:` scheme is removed.
  assert.equal(databasePathFromUrl(':memory:'), ':memory:');
  // A path that merely contains "file:" later on is not a scheme.
  assert.equal(databasePathFromUrl('file:/data/file:name.db'), '/data/file:name.db');
});
