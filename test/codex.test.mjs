// All child processes here are fakes. Windows shim execution has its own fixture suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_DEFAULTS, codexCandidates, defaultSnapshotPath, describeCodexQuota, describeRemaining, findCodexExe, needsShell,
  nextResetAt, readCodexQuota, readCodexQuotaWithFallback, readSnapshot, summarizeRateLimits, toSpawnCommand } from '../lib/codex.js';
import { createCodexRuntime, entryFromQuota } from '../lib/codex-entry.js';
const FIXTURE = fileURLToPath(new URL('./fixtures/codex-quota.snapshot.json', import.meta.url));
const rateReply = { result: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 2000000000 }, planType: 'plus' } }, rateLimitResetCredits: { availableCount: 1 } } };
function childFixture(options = {}) {
  const child = new EventEmitter(), writes = [];
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.kills = 0; child.kill = () => { child.kills++; return true; };
  child.stdin.write = (line, cb) => {
    const message = JSON.parse(line); writes.push(message);
    if (options.writeError) { queueMicrotask(() => child.stdin.emit('error', new Error('FAKE SECRET EPIPE'))); return; }
    if (options.silent) return;
    if (options.exit) { queueMicrotask(() => child.emit(options.exit)); return; }
    const answer = message.method === 'initialize' ? options.init ?? { result: {} }
      : message.method === 'account/read' ? options.account ?? { result: { account: { type: 'chatgpt', planType: 'plus' } } }
      : message.method === 'account/rateLimits/read' ? options.rate ?? rateReply : null;
    if (answer) queueMicrotask(() => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: message.id, ...answer }) + '\n')));
    cb?.();
    return true;
  };
  return { child, writes };
}
const readFake = (options = {}) => {
  const fake = childFixture(options);
  return { fake, promise: readCodexQuota({ candidates: [{ path: 'synthetic/codex.exe', shell: false }], spawnImpl: () => fake.child, timeoutMs: 40 }) };
};
const good = () => ({ ok: true, quota: summarizeRateLimits(rateReply), source: 'codex-app-server', readAt: new Date(1000000).toISOString() });
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshrb-test-codex-'));
  t.after(() => { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
test('candidate discovery uses the requested platform, not host separators', () => {
  const env = { CODEX_BIN: 'C:/custom/codex.exe', PATH: 'C:/tools;C:/other', LOCALAPPDATA: 'C:/synthetic/Local', APPDATA: 'C:/synthetic/Roaming' };
  const list = codexCandidates(env, 'C:/synthetic', 'win32');
  assert.equal(list[0].path, env.CODEX_BIN);
  assert.ok(list.some((x) => x.path === path.win32.join('C:/tools', 'codex.cmd')));
  assert.ok(codexCandidates({ PATH: '/usr/bin:/bin' }, '/synthetic', 'linux').some((x) => x.path === '/usr/bin/codex'));
  assert.equal(needsShell('/bin/codex', 'linux'), false);
});
test('Windows command quoting is explicit; shell metacharacter paths fail closed', () => {
  const cmd = toSpawnCommand({ path: 'C:\\with space\\codex.cmd', shell: true }, ['app-server', '--listen', 'stdio://']);
  assert.equal(cmd.options.windowsVerbatimArguments, true); assert.match(cmd.argv[3], /^""C:/);
  assert.throws(() => toSpawnCommand({ path: 'C:/bad%VAR%/codex.cmd', shell: true }, []));
  assert.deepEqual(toSpawnCommand({ path: '/test/codex', shell: false }, ['app-server']).argv, ['app-server']);
});
test('discovery prefers an existing executable sibling, without guessing nonexistent executables', (t) => {
  const dir = temporary(t), cmd = path.join(dir, 'codex.cmd'), exe = path.join(dir, 'codex.exe');
  fs.writeFileSync(cmd, '@echo off'); assert.equal(findCodexExe([cmd]).path, cmd);
  fs.writeFileSync(exe, 'synthetic'); assert.equal(findCodexExe([cmd]).path, exe);
});
test('quota normalization names actual windows and pairs reset with the limiting one', () => {
  const result = good();
  assert.deepEqual(result.quota.pools.codex.windows.map((w) => w.windowName), ['5 小时窗口', '7 天窗口']);
  assert.match(describeRemaining(result), /还剩 0%（7 天窗口）/);
  assert.equal(nextResetAt(result), 2000000000);
  const entry = entryFromQuota(result, 1000000);
  assert.equal(entry.short, 'GPT 剩 0%'); assert.equal(entry.summary, 'ChatGPT 还剩 0%（7 天窗口）');
  assert.match(describeCodexQuota(result), /重置券 1 张/);
  assert.equal(entryFromQuota({ ok: true, quota: { pools: {} } }), null);
});
for (const bad of [null, undefined, '', ' ', false, true, -1, 101, [], {}, Infinity]) {
  test(`F3 invalid quota percentage ${JSON.stringify(bad)} never becomes 0/100`, () => {
    assert.equal(summarizeRateLimits({ rateLimits: { primary: { usedPercent: bad, windowDurationMins: 300 } } }), null);
  });
}
test('missing reset remains null; a weekly primary never becomes a five-hour window', () => {
  const quota = summarizeRateLimits({ rateLimits: { primary: { usedPercent: 43, windowDurationMins: 10080, resetsAt: null } } });
  assert.equal(quota.pools.codex.fiveHour, null); assert.equal(quota.pools.codex.weekly.resetsAt, null);
  assert.equal(entryFromQuota({ ok: true, quota }).short, 'GPT 剩 57%');
});
test('protocol: strict initialize, initialized notification, account auth, quota, teardown', async () => {
  const { promise, fake } = readFake(); const result = await promise;
  assert.equal(result.ok, true); assert.equal(result.quota.accountPlan, 'plus');
  assert.deepEqual(fake.writes.map((x) => x.method), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
  assert.equal(fake.child.kills, 1);
});
test('initialization refusal prevents business requests and does not leak errors', async () => {
  const { promise, fake } = readFake({ init: { error: { message: 'SECRET' } } });
  const result = await promise; assert.equal(result.reason, 'codex-init-failed'); assert.equal(fake.writes.length, 1); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
test('account/read, not auth.json text, decides sign-in; API Key is not subscription', async () => {
  const signedOut = readFake({ account: { result: { account: null } } });
  assert.equal((await signedOut.promise).reason, 'codex-not-signed-in'); assert.equal(signedOut.fake.writes.length, 3);
  assert.equal((await readFake({ account: { result: { account: { type: 'apiKey' } } } }).promise).reason, 'codex-api-key-account');
});
test('timeouts, exits, stderr, RPC refusal and empty quota are honest failures', async () => {
  assert.equal((await readFake({ silent: true }).promise).reason, 'codex-no-answer');
  for (const exit of ['exit', 'close']) assert.equal((await readFake({ exit }).promise).reason, 'codex-exited');
  assert.equal((await readFake({ rate: { result: {} } }).promise).reason, 'codex-empty');
  const refused = await readFake({ rate: { error: { message: 'Bearer FAKE_SECRET C:/private' } } }).promise;
  assert.equal(refused.reason, 'codex-refused'); assert.doesNotMatch(JSON.stringify(refused), /FAKE_SECRET|private/);
});
test('C3 real Writable asynchronous EPIPE is handled, not an unhandled host crash', async () => {
  const fake = childFixture(); fake.child.stdin = new Writable({ write(chunk, enc, done) { done(new Error('FAKE_EPIPE_SECRET')); } });
  const result = await readCodexQuota({ candidates: ['synthetic/codex'], spawnImpl: () => fake.child, timeoutMs: 100 });
  assert.equal(result.reason, 'codex-stream-error'); assert.equal(fake.child.kills, 1); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
test('stream error listeners cover stdout, stderr, and asynchronous child failure', async () => {
  for (const target of ['stdout', 'stderr', 'child']) {
    const fake = childFixture({ silent: true });
    const pending = readCodexQuota({ candidates: ['synthetic/codex'], spawnImpl: () => fake.child, timeoutMs: 100 });
    (target === 'child' ? fake.child : fake.child[target]).emit('error', new Error('FAKE_SECRET'));
    assert.equal((await pending).ok, false); assert.equal(fake.child.kills, 1);
  }
});
test('technical failures retry a bounded candidate list, auth failures do not', async () => {
  let calls = 0;
  const result = await readCodexQuota({ candidates: ['first', 'second'], timeoutMs: 100, spawnImpl: () => { calls++; if (calls === 1) throw new Error('FAKE'); return childFixture().child; } });
  assert.equal(result.ok, true); assert.equal(calls, 2);
  calls = 0;
  const signedOut = await readCodexQuota({ candidates: ['first', 'second'], timeoutMs: 100, spawnImpl: () => { calls++; return childFixture({ account: { result: { account: null } } }).child; } });
  assert.equal(signedOut.reason, 'codex-not-signed-in'); assert.equal(calls, 1);
});
test('snapshots validate schema/time/numbers and respect CODEX_HOME', async (t) => {
  const dir = temporary(t), file = path.join(dir, 'rate-limits.snapshot.json');
  fs.writeFileSync(file, '{}'); assert.equal(readSnapshot(file), null);
  fs.writeFileSync(file, JSON.stringify({ generated: 'invalid', pools: {} })); assert.equal(readSnapshot(file), null);
  fs.copyFileSync(FIXTURE, file);
  assert.equal(defaultSnapshotPath({ CODEX_HOME: dir }, '/synthetic'), file);
  const result = await readCodexQuotaWithFallback({ config: { strategy: 'snapshot', snapshotPath: file }, candidates: [], env: {}, home: dir, spawnImpl: () => { throw new Error('must not spawn'); } });
  assert.equal(result.ok, true); assert.equal(result.stale, true); assert.equal(result.source, 'snapshot');
  assert.equal(entryFromQuota(result).short, 'GPT 剩 0%（旧）');
  assert.equal((await readCodexQuotaWithFallback({ config: { strategy: 'off' }, env: {}, home: dir })).reason, 'codex-disabled');
});
function clock() { let at = 1000000, callback; const timers = { setInterval(fn) { callback = fn; return 1; }, clearInterval() { callback = null; } }; return { timers, now: () => at, advance: (ms) => at += ms, fire: () => callback?.(), active: () => !!callback }; }
test('F4 runtime: entry never reads, starts once, shares in-flight and preserves last-good', async () => {
  const time = clock(); let reads = 0, finish;
  const runtime = createCodexRuntime({ warmMs: 30000 }, { ...time, read: () => { reads++; return new Promise((resolve) => { finish = resolve; }); } });
  assert.equal(runtime.entry().kind, 'loading'); assert.equal(reads, 0);
  const first = runtime.start(); assert.equal(runtime.start(), first); await Promise.resolve();
  time.fire(); time.fire(); assert.equal(reads, 1); finish(good()); await first;
  assert.equal(runtime.entry().short, 'GPT 剩 0%');
  time.advance(90001); assert.equal(runtime.entry().stale, true); assert.equal(reads, 1);
  time.fire(); await Promise.resolve(); finish({ ok: false, reason: 'codex-no-answer', detail: 'SECRET' });
  await new Promise(setImmediate); assert.equal(runtime.entry().kind, 'ready'); assert.equal(runtime.entry().stale, true);
  assert.doesNotMatch(runtime.entry().detail, /SECRET/); runtime.stop(); assert.equal(time.active(), false);
});
test('runtime lifetime: stop aborts pending child and no restart or extra spawn follows', async () => {
  const time = clock(), fake = childFixture({ silent: true }); let spawns = 0;
  const runtime = createCodexRuntime({ timeoutMs: 1000 }, { ...time, candidates: ['fake'], env: {}, home: '/synthetic', spawnImpl: () => { spawns++; return fake.child; } });
  const pending = runtime.start(); await Promise.resolve(); runtime.stop(); await pending;
  assert.equal(fake.child.kills, 1); runtime.start(); time.fire(); assert.equal(spawns, 1); assert.equal(time.active(), false);
});
test('separate activations cannot share cache or an in-flight promise', async () => {
  const a = createCodexRuntime({}, { ...clock(), read: async () => good() });
  const b = createCodexRuntime({}, { ...clock(), read: async () => ({ ok: false, reason: 'codex-not-signed-in' }) });
  await Promise.all([a.start(), b.start()]);
  assert.equal(a.entry().kind, 'ready'); assert.equal(b.entry().kind, 'unavailable'); a.stop(); b.stop();
});
test('off strategy neither starts a timer nor reads', () => {
  const time = clock(), runtime = createCodexRuntime({ strategy: 'off' }, { ...time, read: () => { throw new Error('must not read'); } });
  runtime.start(); assert.equal(runtime.entry(), null); assert.equal(time.active(), false); runtime.stop();
  assert.equal(CODEX_DEFAULTS.strategy, 'auto');
});
