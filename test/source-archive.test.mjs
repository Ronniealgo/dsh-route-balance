import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, temporary } from './helpers.mjs';
import { sourceFiles, sourceRecords } from '../tools/release-files.mjs';
import { checkSource } from '../tools/check-source.mjs';
test('release source files exclude Git history, machine profiles and dependencies', () => {
  const files = sourceFiles();
  assert.ok(files.includes('LICENSE')); assert.ok(files.includes('test/host-auth.integration.test.mjs')); assert.ok(files.includes('tools/install-state.mjs'));
  assert.ok(!files.some((name) => name.split('/').some((segment) => ['.git', 'node_modules', '.dsh', '.codex', 'outputs'].includes(segment))));
  assert.ok(!files.includes('MANIFEST.txt'), 'the checksum list must not hash itself');
  for (const record of sourceRecords()) { assert.match(record.sha256, /^[a-f0-9]{64}$/); assert.ok(record.bytes >= 0); }
});
test('source documentation links, privacy heuristics and all JavaScript syntax are checked', () => {
  const result = checkSource();
  assert.equal(result.passed, true, result.issues.join('\n'));
});
test('source checker finds a personal path and a broken documentation link', (t) => {
  const dir = temporary(t, 'source-docs-');
  for (const file of sourceFiles()) {
    const to = path.join(dir, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), to);
  }
  fs.appendFileSync(path.join(dir, 'README.md'), '\nC:/Users/a/private\n[missing](does-not-exist.txt)\n');
  const result = checkSource(dir, { syntax: false });
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((text) => text.includes('personal path')));
  assert.ok(result.issues.some((text) => text.includes('broken local link')));
});
test('source collector refuses a link instead of publishing files outside checkout', (t) => {
  const dir = temporary(t, 'source-boundary-');
  for (const file of sourceFiles()) {
    const to = path.join(dir, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), to);
  }
  const link = path.join(dir, 'tools', 'unsafe-link');
  fs.symlinkSync(ROOT, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => sourceFiles(dir), /refuses links/);
});
