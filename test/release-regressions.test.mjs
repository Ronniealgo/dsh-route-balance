import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readCodexQuota, summarizeRateLimits } from '../lib/codex.js';
import { createCodexRuntime, entryFromQuota } from '../lib/codex-entry.js';
import { createEnvironment, generateBundleSource, loadBundle } from '../tools/fake-runtime.mjs';
import { entriesFromHostPayload } from '../lib/registry.js';
import { asNumber, totalsByCurrency } from '../lib/core.js';
import { readSnapshot } from '../lib/codex.js';
import fs from 'node:fs';
import path from 'node:path';
import { temporary } from './helpers.mjs';

test('fractional remaining allowance is not rounded down into a false exhausted zero', () => {
  const quota = summarizeRateLimits({ rateLimits: { primary: { usedPercent: 99.999, windowDurationMins: 300 } } });
  assert.equal(entryFromQuota({ ok: true, quota }).short, 'GPT 剩 <0.01%');
});
test('legacy snapshot time still requires a real ISO timestamp, not Date.parse coercion', (t) => {
  const dir = temporary(t, 'snapshot-time-'), file = path.join(dir, 'snapshot.json');
  fs.writeFileSync(file, JSON.stringify({ generated: '1', pools: { codex: { weekly: { usedPercent: 25 } } } }));
  assert.equal(readSnapshot(file), null);
});
test('wallet numeric coercion cannot accept arrays, objects or overflowing totals', () => {
  for (const value of [[1], [], {}, true, false, null]) assert.equal(asNumber(value), null);
  assert.equal(asNumber('0E-16'), 0);
  assert.deepEqual(totalsByCurrency([{ currency: 'CNY', balance: 1e308 }, { currency: 'CNY', balance: 1e308 }]), []);
});
for (const maxAttempts of [NaN, Infinity, 'bad', 999]) {
  test(`candidate retries stay bounded with invalid maxAttempts ${String(maxAttempts)}`, async () => {
    let calls = 0;
    const result = await readCodexQuota({ candidates: ['a', 'b', 'c', 'd', 'e'], maxAttempts, spawnImpl() { calls++; throw new Error('synthetic'); }, timeoutMs: 100 });
    assert.equal(result.ok, false); assert.ok(calls <= 3); assert.equal(calls, 3);
  });
}
test('wire contract cannot accept a different or missing version as a live reading', () => {
  for (const version of [undefined, 0, 2, '1']) {
    const entries = entriesFromHostPayload({ ok: true, version, entries: [{ id: 'x', kind: 'ready', amounts: [{ currency: 'USD', text: '$1.00' }] }] });
    assert.equal(entries[0].kind, 'failed');
  }
});
test('account Remote ready with no valid balance is not a fabricated ready value', async () => {
  const env = createEnvironment(); loadBundle(env, { source: generateBundleSource() }); const api = env.factory();
  const result = await api.accountSource.read({ remote: { account: {
    getState: async () => ({ ok: true, value: { status: 'credential-stored' } }),
    getBalance: async () => ({ ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: false }] } }),
  } } });
  assert.equal(result.kind, 'failed');
});
test('browser source exceptions do not display or log raw secret messages', async () => {
  const env = createEnvironment(); loadBundle(env, { source: generateBundleSource() }); const api = env.factory();
  const logs = [];
  const store = api.createStore({ remoteSources: [{ id: 'fake', read() { throw new Error('Bearer SYNTHETIC_SECRET C:/private'); } }], hostSources: [], metadata: () => ({}), refreshMs: 60000, log: (...args) => logs.push(args), timers: env.sandbox });
  const snapshot = await store.refresh();
  assert.equal(snapshot.entries[0].kind, 'failed'); assert.doesNotMatch(JSON.stringify({ snapshot, logs }), /SYNTHETIC_SECRET|private/);
  store.dispose();
});
test('successful cache is erased on sign-out, not retained as another account quota', async () => {
  let read = 0, tick;
  const timers = { setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = null; } };
  const quota = summarizeRateLimits({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 10080 } } });
  const runtime = createCodexRuntime({}, { timers, read: async () => ++read === 1 ? { ok: true, quota, readAt: new Date().toISOString() } : { ok: false, reason: 'codex-not-signed-in' } });
  await runtime.start(); assert.equal(runtime.entry().kind, 'ready');
  tick(); await new Promise(setImmediate);
  assert.equal(runtime.entry().kind, 'unavailable'); assert.doesNotMatch(JSON.stringify(runtime.entry()), /还剩 75|GPT 剩/); runtime.stop();
});
test('aborted read cancels immediately and starts no subprocess', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await readCodexQuota({ signal: controller.signal, candidates: ['fake'], spawnImpl() { throw new Error('must not spawn'); } });
  assert.equal(result.reason, 'codex-cancelled');
});
test('protocol refuses oversized output rather than retaining unbounded stdout', async () => {
  const child = new EventEmitter(); child.stdin = { write() {} }; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true;
  const pending = readCodexQuota({ candidates: ['fake'], spawnImpl: () => child, timeoutMs: 100 });
  child.stdout.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1, 120));
  assert.equal((await pending).reason, 'codex-protocol-limit');
});
