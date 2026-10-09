// Execute only synthetic shims under an isolated temp tree, never installed Codex.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readCodexQuota } from '../lib/codex.js';
import { temporary } from './helpers.mjs';
const server = `const readline = require('node:readline');
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.join('|') !== 'app-server|--listen|stdio://') process.exit(7);
fs.writeFileSync(process.env.DSH_SHIM_PID_FILE, String(process.pid));
let initialized = false;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialized') { initialized = true; return; }
  let result;
  if (request.method === 'initialize') result = { userAgent: 'synthetic-shim' };
  else if (request.method === 'account/read' && initialized) result = { account: { type: 'chatgpt', planType: 'plus' } };
  else if (request.method === 'account/rateLimits/read' && initialized) result = { rateLimits: { primary: { usedPercent: 43, windowDurationMins: 10080, resetsAt: 2000000000 } } };
  else process.exit(8);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`;
for (const folder of ['plain', 'with spaces', 'with (parentheses)']) {
  test(`F5 actual Windows .cmd shim: ${folder}, RPC and process tree cleanup`, { skip: process.platform !== 'win32', timeout: 15000 }, async (t) => {
    const dir = temporary(t, 'shim-'), cwd = path.join(dir, folder);
    fs.mkdirSync(cwd);
    const shim = path.join(cwd, 'codex.cmd'), script = path.join(cwd, 'answer.cjs'), pidFile = path.join(dir, 'pid.txt');
    fs.writeFileSync(script, server);
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0answer.cjs" %*\r\n`);
    const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, ComSpec: process.env.ComSpec,
      PATH: path.dirname(process.execPath) + ';' + path.join(process.env.SystemRoot, 'System32'),
      TEMP: dir, TMP: dir, USERPROFILE: dir, CODEX_HOME: path.join(dir, 'codex-home'), DSH_SHIM_PID_FILE: pidFile };
    const result = await readCodexQuota({ candidates: [{ path: shim, shell: true }], retryCandidates: false, env, home: dir, timeoutMs: 10000 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.quota.pools.codex.weekly.remainingPercent, 57);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), /ESRCH|No such process/);
  });
}
// This executes the protocol helper directly on every platform, providing a real
// subprocess smoke without depending on any system Codex executable or login.
test('actual synthetic Node RPC process returns quota and is terminated', { timeout: 15000 }, async (t) => {
  const dir = temporary(t, 'rpc-'), script = path.join(dir, 'answer.cjs'), pidFile = path.join(dir, 'pid.txt');
  fs.writeFileSync(script, server);
  const { spawn } = await import('node:child_process');
  const result = await readCodexQuota({ candidates: [{ path: process.execPath, shell: false }], retryCandidates: false,
    env: { ...process.env, CODEX_HOME: dir, DSH_SHIM_PID_FILE: pidFile }, timeoutMs: 10000,
    spawnImpl(file, args, options) { return spawn(file, [script, ...args], options); },
    killImpl(child) { child.kill(); },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); return; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('synthetic child remains alive after quota read');
});
