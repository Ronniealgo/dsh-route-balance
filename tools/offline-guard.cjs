// Test-only tripwire. Not a sandbox; rejects accidental real account side effects.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const net = require('node:net');
const { fileURLToPath } = require('node:url');
const normalize = (v) => path.resolve(v).toLowerCase();
const forbidden = [normalize(path.join(os.homedir(), '.dsh')), normalize(path.join(os.homedir(), '.codex'))];
function checkFile(value) {
  if (typeof value === 'number' || value == null) return;
  let name;
  try { name = normalize(value instanceof URL ? fileURLToPath(value) : String(value)); } catch { return; }
  if (forbidden.some((root) => name === root || name.startsWith(root + path.sep))) throw new Error('OFFLINE_GUARD: real account files are forbidden');
}
for (const key of ['readFileSync', 'writeFileSync', 'appendFileSync', 'openSync', 'unlinkSync', 'rmSync', 'readFile', 'writeFile', 'appendFile', 'open', 'unlink', 'rm']) {
  const original = fs[key]; fs[key] = function (file, ...args) { checkFile(file); return original.call(this, file, ...args); };
}
for (const key of ['readFile', 'writeFile', 'appendFile', 'open', 'unlink', 'rm']) {
  const original = fs.promises[key]; fs.promises[key] = async function (file, ...args) { checkFile(file); return original.call(this, file, ...args); };
}
for (const key of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[key]; cp[key] = function (file, ...args) {
    const text = String(file) + ' ' + (Array.isArray(args[0]) ? args[0].join(' ') : '');
    if (/(?:^|[\\/\s])reg(?:\.exe)?(?:\s|$)/i.test(text)) throw new Error('OFFLINE_GUARD: registry access is forbidden');
    if (/(?:^|[\\/\s"])codex(?:\.(?:exe|cmd|bat))?(?:[\s"]|$)/i.test(text) && !text.includes('dshrb-test-')) throw new Error('OFFLINE_GUARD: real Codex execution is forbidden');
    return original.call(this, file, ...args);
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('OFFLINE_GUARD: external fetch is forbidden');
  return originalFetch(input, init);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const first = values[0];
  const host = first && typeof first === 'object' ? first.host : typeof values[1] === 'string' ? values[1] : 'localhost';
  if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('OFFLINE_GUARD: external socket is forbidden');
  return connect.apply(this, args);
};
require('node:module').syncBuiltinESMExports();
