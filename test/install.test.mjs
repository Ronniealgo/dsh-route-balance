import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installPackage } from '../tools/install-state.mjs';
import { parsePatch } from '../tools/patch-check.mjs';
import { ROOT, profile, temporary } from './helpers.mjs';
const base = '- insert:\n    - id: unrelated\n      name: "example"\n';
const cases = { LF: base, CRLF: base.replaceAll('\n', '\r\n'), BOM: '\uFEFF' + base, noFinalNewline: base.trimEnd(), trailingBlank: base + '\n\n', trailingComment: base + '# KEEP THIS COMMENT\n', chinese: '# 中文注释\n' + base + '# 尾部用户注释', unrelatedName: base + '# route-balance is only a comment\n' };
for (const [name, text] of Object.entries(cases)) test(`F6 exact bytes round-trip: ${name}`, (t) => {
  const bytes = Buffer.from(text), f = profile(t, bytes), args = { dshHome: f.home, root: ROOT };
  installPackage(args);
  const installed = fs.readFileSync(f.patch);
  assert.ok(installed.subarray(0, bytes.length).equals(bytes));
  assert.equal(parsePatch(installed.toString('utf8'), path.join(f.dir, 'package.json')).length, 2);
  installPackage(args); assert.ok(fs.readFileSync(f.patch).equals(installed));
  const backups = fs.readdirSync(f.dir).filter((n) => n.includes('.bak-route-balance-'));
  assert.equal(backups.length, 1); assert.ok(fs.readFileSync(path.join(f.dir, backups[0])).equals(bytes));
  installPackage({ ...args, uninstall: true }); assert.ok(fs.readFileSync(f.patch).equals(bytes));
  assert.equal(fs.existsSync(f.link), false);
  assert.equal(installPackage({ ...args, uninstall: true }).changed, false); assert.ok(fs.readFileSync(f.patch).equals(bytes));
});
test('F6 empty flow sequences and malformed YAML fail before changing bytes or links', (t) => {
  for (const text of ['[]\n', '\uFEFF[ ]\r\n', '[broken:']) {
    const f = profile(t, Buffer.from(text));
    assert.throws(() => installPackage({ dshHome: f.home, root: ROOT }));
    assert.equal(fs.readFileSync(f.patch, 'utf8'), text); assert.equal(fs.existsSync(f.link), false); assert.equal(fs.existsSync(f.state), false);
  }
});
test('F6 unlink only the owned block and retain comments appended after installation', (t) => {
  const f = profile(t, Buffer.from(base)); installPackage({ dshHome: f.home, root: ROOT });
  fs.appendFileSync(f.patch, '# added later\n');
  installPackage({ dshHome: f.home, root: ROOT, uninstall: true });
  assert.equal(fs.readFileSync(f.patch, 'utf8'), base + '# added later\n');
});
test('F6 edited or incomplete managed block fails closed with code 2', (t) => {
  const f = profile(t, Buffer.from(base)); const args = { dshHome: f.home, root: ROOT }; installPackage(args);
  const edited = fs.readFileSync(f.patch, 'utf8').replace('# <<< dsh-route-balance <<<', '# removed end'); fs.writeFileSync(f.patch, edited);
  assert.throws(() => installPackage({ ...args, uninstall: true }), (e) => e.exitCode === 2);
  assert.equal(fs.readFileSync(f.patch, 'utf8'), edited); assert.ok(fs.existsSync(f.link));
});
test('F6 owned write rollback when junction creation fails', (t) => {
  const f = profile(t, Buffer.from(base));
  assert.throws(() => installPackage({ dshHome: f.home, root: ROOT }, { createLink() { throw new Error('synthetic link failure'); } }), /synthetic/);
  assert.equal(fs.readFileSync(f.patch, 'utf8'), base); assert.equal(fs.existsSync(f.state), false); assert.equal(fs.existsSync(f.link), false);
});
test('F6 preserve foreign directories and unmanaged Loader rows', (t) => {
  const f = profile(t, Buffer.from(base)); fs.mkdirSync(f.link); fs.writeFileSync(path.join(f.link, 'keep'), 'user');
  assert.throws(() => installPackage({ dshHome: f.home, root: ROOT }), (e) => e.exitCode === 2);
  assert.equal(fs.readFileSync(path.join(f.link, 'keep'), 'utf8'), 'user'); assert.equal(fs.readFileSync(f.patch, 'utf8'), base);
  const other = profile(t, Buffer.from(base.replace('unrelated', 'route-balance')));
  assert.throws(() => installPackage({ dshHome: other.home, root: ROOT }));
});
test('pre-existing correct junction remains user-owned after uninstall', (t) => {
  const f = profile(t, Buffer.from(base)); fs.symlinkSync(ROOT, f.link, process.platform === 'win32' ? 'junction' : 'dir');
  installPackage({ dshHome: f.home, root: ROOT }); installPackage({ dshHome: f.home, root: ROOT, uninstall: true });
  assert.ok(fs.lstatSync(f.link).isSymbolicLink()); assert.equal(fs.readFileSync(f.patch, 'utf8'), base);
});
test('a missing user-owned junction recreated by the installer becomes owned and is removed', (t) => {
  const f = profile(t, Buffer.from(base));
  fs.symlinkSync(ROOT, f.link, process.platform === 'win32' ? 'junction' : 'dir');
  installPackage({ dshHome: f.home, root: ROOT });
  assert.equal(path.dirname(f.link), path.join(f.dir, 'node_modules'));
  fs.unlinkSync(f.link);
  assert.equal(installPackage({ dshHome: f.home, root: ROOT }).changed, true);
  installPackage({ dshHome: f.home, root: ROOT, uninstall: true });
  assert.equal(fs.existsSync(f.link), false);
  assert.equal(fs.readFileSync(f.patch, 'utf8'), base);
});
for (const shell of ['powershell.exe', 'pwsh']) test(`Windows entry point ${shell}: byte fixtures and exit codes`, { skip: process.platform !== 'win32', timeout: 60000 }, (t) => {
  const probe = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (probe.error?.code === 'ENOENT') { t.skip(`${shell} is not installed in this environment`); return; }
  assert.equal(probe.status, 0, `PowerShell probe: ${probe.error?.code ?? ''} ${probe.stderr}`);
  // Run the exact installer bytes in a local, test-owned package. Do not lower
  // the operator's execution policy or depend on a checkout's Internet-zone tag.
  const staged = temporary(t, 'installer-entry-');
  for (const relative of ['install.ps1', 'package.json', 'tools/install-state.mjs', 'tools/patch-check.mjs']) {
    const bytes = fs.readFileSync(path.join(ROOT, relative)), target = path.join(staged, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    assert.ok(fs.readFileSync(target).equals(bytes), `exact installer package bytes: ${relative}`);
  }
  const run = (home, extra = []) => spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(staged, 'install.ps1'), '-DshHome', home, ...extra], { cwd: staged, encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, DSH_ROUTE_BALANCE_TEST: '1' } });
  for (const [name, text] of Object.entries(cases)) {
    const f = profile(t, Buffer.from(text));
    const install = run(f.home); assert.equal(install.status, 0, `${name}: ${install.error?.code ?? ''} ${install.stderr} ${install.stdout}`);
    const remove = run(f.home, ['-Uninstall']); assert.equal(remove.status, 0, remove.stderr);
    assert.equal(fs.readFileSync(f.patch, 'utf8'), text, name);
  }
  const f = profile(t, Buffer.from('[]\n')), refused = run(f.home);
  assert.equal(refused.status, 3); assert.equal(fs.readFileSync(f.patch, 'utf8'), '[]\n');
});
