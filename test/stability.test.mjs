// Synthetic-only stability and identity regressions. No accounts or live suppliers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, retainReading, headlineText, balanceTooltip, mergeEntries } from '../lib/registry.js';
import { createBalanceReader, amountOf, PROVIDERS } from '../lib/index.js';
import { createCodexRuntime } from '../lib/codex-entry.js';
import { summarizeRateLimits } from '../lib/codex.js';
import { createEnvironment, loadBundle, generateBundleSource, createFakeContext, createHookSession, renderWithHooks } from '../tools/fake-runtime.mjs';

const money = (id, text = '$1.00', extra = {}) => ({ id, label: id, kind: 'ready', amounts: [{ currency: 'USD', text }], ...extra });
const failure = (id, extra = {}) => ({ id, label: id, kind: 'failed', detail: 'HTTP 503', ...extra });
const reply = (entries, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ ok: true, version: 1, entries }) });
const flush = () => new Promise(setImmediate);
const inertTimers = { setInterval: () => 1, clearInterval: () => {} };
function fixture(fetchImpl, extra = {}) {
  return createStore({ hostSources: [{ id: 'vendors', path: '/api/synthetic' }], refreshMs: 60000, metadata: () => ({}),
    timers: inertTimers, fetchImpl, ...extra });
}

test('stable: one failed refresh keeps each previous amount, then restores freshness', async () => {
  let round = 0, clock = 100;
  const store = fixture(async () => reply(++round === 1 ? [money('A'), money('B', '$2.00')] :
    round === 2 ? [money('A'), failure('B')] : [money('A'), money('B', '$3.00')]), { now: () => clock });
  await store.refresh(); clock += 60000; await store.refresh();
  let b = store.getSnapshot().entries.find(e => e.id === 'B');
  assert.equal(b.kind, 'ready'); assert.equal(b.stale, true); assert.equal(b.lastSuccessAt, 100);
  assert.equal(b.amounts[0].text, '$2.00'); assert.match(headlineText(store.getSnapshot()), /\$2\.00（上次）/);
  clock += 60000; await store.refresh(); b = store.getSnapshot().entries.find(e => e.id === 'B');
  assert.equal(b.amounts[0].text, '$3.00'); assert.equal(b.stale, false); assert.equal(b.lastSuccessAt, clock);
  store.dispose();
});
test('stable: whole-host network failure and HTTP 503 preserve individual vendor identities', async () => {
  let round = 0;
  const store = fixture(async () => { round++; if (round === 2) throw new Error('synthetic disconnect');
    return round === 3 ? reply([], 503) : reply([money('A'), money('B', '$0.00')]); });
  await store.refresh(); await store.refresh(); await store.refresh();
  assert.deepEqual(store.getSnapshot().entries.map(e => e.id), ['A', 'B']);
  assert.ok(store.getSnapshot().entries.every(e => e.kind === 'ready' && e.stale));
  assert.match(balanceTooltip(store.getSnapshot()), /B：\$0\.00（上次）/); store.dispose();
});
test('stable: repeated failures never extend the age of the last success', async () => {
  let clock = 0, round = 0;
  const store = fixture(async () => reply(++round === 1 ? [money('A')] : [failure('A')]), { now: () => clock, maxStaleMs: 100 });
  await store.refresh(); clock = 50; await store.refresh(); clock = 100; await store.refresh();
  assert.equal(store.getSnapshot().entries[0].lastSuccessAt, 0);
  clock = 101; await store.refresh(); const entry = store.getSnapshot().entries[0];
  assert.equal(entry.kind, 'failed'); assert.equal(entry.id, 'A'); assert.doesNotMatch(headlineText(store.getSnapshot()), /\$1\.00/);
  assert.match(balanceTooltip(store.getSnapshot()), /A：暂不可用/); store.dispose();
});
test('stable: stale data already expired on the host cannot gain a new lease on the client', () => {
  const current = money('A', '$1.00', { stale: true, lastSuccessAt: 1 });
  const result = retainReading(undefined, current, 200, 100);
  assert.equal(result.kind, 'failed'); assert.equal(result.amounts, undefined);
});
test('stable: explicit auth/reset/unavailable and changed generation erase old amounts', () => {
  const previous = money('A', '$5.00', { generation: 'account-A', lastSuccessAt: 0 });
  for (const current of [failure('A', { retryable: false }), failure('A', { cachePolicy: 'reset' }),
    { id: 'A', kind: 'unavailable' }, failure('A', { generation: 'account-B' })]) {
    const result = retainReading(previous, current, 10, 100);
    assert.notEqual(result.kind, 'ready'); assert.equal(result.amounts, undefined);
  }
});
for (const status of [401, 403]) test(`stable: host HTTP ${status} clears all previous vendor money`, async () => {
  let n = 0; const store = fixture(async () => ++n === 1 ? reply([money('A'), money('B')]) : reply([], status));
  await store.refresh(); await store.refresh();
  assert.ok(store.getSnapshot().entries.every(e => e.kind !== 'ready'));
  assert.doesNotMatch(balanceTooltip(store.getSnapshot()), /\$1\.00/); store.dispose();
});
test('stable: authoritative empty inventory deletes routes instead of retaining ghosts', async () => {
  let n = 0; const store = fixture(async () => reply(++n === 1 ? [money('A')] : []));
  await store.refresh(); await store.refresh(); assert.deepEqual(store.getSnapshot().entries, []); store.dispose();
});
test('stable: missing credential and account logout cannot become fake zero', async () => {
  let n = 0; const store = fixture(async () => reply(++n === 1 ? [money('A')] : [{ id: 'A', kind: 'unavailable', configured: false, cachePolicy: 'reset' }]));
  await store.refresh(); await store.refresh();
  assert.equal(store.getSnapshot().entries[0].kind, 'unavailable'); assert.doesNotMatch(balanceTooltip(store.getSnapshot()), /0\.00|1\.00/); store.dispose();
});
test('stable: a healthy source is published while another source ignores abort forever', async () => {
  let hungSignal;
  const store = createStore({ requestTimeoutMs: 15, timers: inertTimers, metadata: () => ({}),
    remoteSources: [{ id: 'fast', read: async () => money('fast') }, { id: 'hang', read: ({ signal }) => {
      hungSignal = signal; return new Promise(() => {});
    } }] });
  const work = store.refresh(); await flush();
  assert.equal(store.getSnapshot().entries.find(e => e.id === 'fast')?.kind, 'ready');
  await work; assert.equal(hungSignal.aborted, true);
  assert.equal(store.getSnapshot().entries.find(e => e.id === 'hang')?.kind, 'failed');
  assert.equal(store.state().activeRequests, 0); store.dispose();
});
test('stable: deadline ends an ignored fetch, and the very next cycle can recover', async () => {
  let n = 0, firstSignal;
  const store = fixture(async (_url, init) => { if (++n === 1) { firstSignal = init.signal; return new Promise(() => {}); }
    return reply([money('A')]); }, { requestTimeoutMs: 15 });
  await store.refresh(); assert.equal(firstSignal.aborted, true); await store.refresh();
  assert.equal(store.getSnapshot().entries[0].kind, 'ready'); assert.equal(store.state().activeRequests, 0); store.dispose();
});
test('stable: a thrown subscriber cannot lock refresh or silence healthy subscribers', async () => {
  let delivered = 0; const store = fixture(async () => reply([money('A')]));
  const a = store.subscribe(() => { throw new Error('synthetic listener'); });
  const b = store.subscribe(() => delivered++); await store.refresh(); await store.refresh();
  assert.ok(delivered >= 2); a(); b(); store.dispose();
});
test('stable: last unsubscribe aborts in-flight work; late data never overwrites a new cycle', async () => {
  let finish, signal, calls = 0;
  const store = fixture((_url, init) => { calls++; signal = init.signal; return new Promise(resolve => { finish = () => resolve(reply([money('old')])); }); }, { requestTimeoutMs: 1000 });
  const unsub = store.subscribe(() => {}); await flush(); const before = store.getSnapshot(); unsub();
  assert.equal(signal.aborted, true); finish(); await flush();
  assert.equal(store.getSnapshot(), before); assert.equal(store.state().timerActive, false); assert.equal(calls, 1); store.dispose();
});
test('stable: disposed requests terminate and cannot publish or make more fetch calls', async () => {
  let signal, n = 0; const store = fixture((_url, init) => { n++; signal = init.signal; return new Promise(() => {}); });
  const work = store.refresh(); await flush(); const before = store.getSnapshot(); store.dispose(); await work;
  assert.equal(signal.aborted, true); assert.equal(await store.refresh(), before); assert.equal(n, 1);
});
test('stable: pause makes no requests; resume catches up without adding multiple intervals', async () => {
  let calls = 0, next = 0; const intervals = new Map();
  const store = fixture(async () => { calls++; return reply([money('A')]); }, {
    timers: { setInterval(fn) { const key = ++next; intervals.set(key, fn); return key; }, clearInterval(key) { intervals.delete(key); } },
  });
  const unsub = store.subscribe(() => {}); await store.refresh(); assert.equal(intervals.size, 1);
  store.pause(); await store.refresh(); assert.equal(calls, 1); assert.equal(intervals.size, 0);
  await store.resume(); await store.resume(); assert.equal(intervals.size, 1); assert.equal(calls, 3);
  unsub(); store.dispose(); assert.equal(intervals.size, 0);
});
test('stable: fresh fallback outranks a stale direct source for the same route', () => {
  const entries = mergeEntries([[money('A', '$9.00', { stale: true })], [money('A', '$8.00')]]);
  assert.equal(entries[0].amounts[0].text, '$8.00');
});
test('stable: tooltip uses exactly one amount per line, blank separator and a clear last-read mark', () => {
  const a = money('A', '$1.00'); a.amounts.push({ currency: 'CNY', text: '¥2.00' });
  const text = balanceTooltip({ entries: [a, money('B', '$0.00', { stale: true }), failure('C', { configured: true })] });
  assert.equal(text, 'A：$1.00\nA：¥2.00\n\nB：$0.00（上次）\n\nC：暂不可用');
  assert.doesNotMatch(text, /HTTP|credential|点击刷新/);
});

function hostFixture(extra = {}) {
  let key = 'SYNTHETIC_A', mode = 'ready', calls = 0, clock = 0;
  const provider = { id: 'A', label: 'A', credential: 'SYNTHETIC_KEY', async read({ key: resolved }) {
    calls++; if (mode === 'throw') throw new Error('Bearer ' + resolved);
    if (mode === 'auth') return { kind: 'failed', retryable: false, cachePolicy: 'reset', detail: 'HTTP 401' };
    if (mode === 'invalid') return { kind: 'ready', amounts: [null] };
    return { kind: 'ready', amounts: [amountOf('USD', mode === 'zero' ? 0 : 2)], detail: resolved };
  } };
  const reader = createBalanceReader({ providers: [provider], credentials: { resolve: async () => {
    if (key === 'DENIED') throw new Error('synthetic access denied');
    return key === undefined ? undefined : { value: key };
  } }, config: { cacheMs: 0, maxStaleMs: 100, codex: { strategy: 'off' }, ...extra.config }, now: () => clock, ...extra });
  return { reader, key: value => { key = value; }, mode: value => { mode = value; }, clock: value => { clock = value; }, calls: () => calls };
}
test('host stable: provider succeeds, disconnects, recovers without losing the reading', async () => {
  const f = hostFixture(); const first = (await f.reader.read()).entries[0];
  f.mode('throw'); f.clock(50); const old = (await f.reader.read()).entries[0];
  assert.equal(old.kind, 'ready'); assert.equal(old.stale, true); assert.equal(old.lastSuccessAt, 0);
  assert.equal(old.generation, first.generation); assert.doesNotMatch(JSON.stringify(old), /SYNTHETIC_A|Bearer/);
  f.mode('zero'); f.clock(80); const zero = (await f.reader.read()).entries[0];
  assert.equal(zero.amounts[0].text, '$0.00'); assert.equal(zero.stale, false); f.reader.dispose();
});
test('host stable: deleted, invalid or denied keys clear successes even inside the HTTP cache window', async () => {
  for (const key of [undefined, 'DENIED', 'BAD\nKEY']) {
    const f = hostFixture({ config: { cacheMs: 10000 } }); await f.reader.read(); f.key(key);
    const result = (await f.reader.read()).entries[0]; assert.notEqual(result.kind, 'ready');
    assert.equal(result.cachePolicy, 'reset'); assert.ok(!result.amounts?.length);
    if (result.kind === 'failed') assert.equal(balanceTooltip({ entries: [result] }), 'A：需重新登录或配置', 'credential denial keeps an actionable route status, never an old amount');
    f.reader.dispose();
  }
});
test('host stable: credential rotation changes public generation and never replays the old balance', async () => {
  const f = hostFixture({ config: { cacheMs: 10000 } }); const first = (await f.reader.read()).entries[0];
  f.key('SYNTHETIC_B'); f.mode('throw'); const next = (await f.reader.read()).entries[0];
  assert.notEqual(next.generation, first.generation); assert.equal(next.kind, 'failed');
  assert.doesNotMatch(JSON.stringify(next), /SYNTHETIC_|fingerprint/); f.reader.dispose();
});
test('host stable: HTTP 401 and malformed success cannot invent or resurrect money', async () => {
  const f = hostFixture(); await f.reader.read(); f.mode('auth'); const auth = (await f.reader.read()).entries[0];
  assert.equal(auth.kind, 'failed'); assert.equal(auth.amounts, null);
  f.mode('invalid'); const invalid = (await f.reader.read()).entries[0]; assert.equal(invalid.kind, 'failed'); f.reader.dispose();
});
test('host stable: shared refreshes, deadlines and disposal stay bounded', async () => {
  let calls = 0, signal;
  const reader = createBalanceReader({ providers: [{ id: 'hang', read(x) { calls++; signal = x.signal; return new Promise(() => {}); } }], timeoutMs: 15, config: { cacheMs: 0 } });
  const first = reader.read(), second = reader.read(); assert.equal(first, second);
  const body = await first; assert.equal(body.entries[0].kind, 'failed'); assert.equal(signal.aborted, true); assert.equal(calls, 1);
  const pending = reader.read(); await flush(); reader.dispose();
  assert.equal((await pending).ok, false); assert.equal((await reader.read()).ok, false); assert.equal(reader.state().providers, 0);
});
test('host stable: unresolved credentials time out closed, not as cached account data', async () => {
  let hanging = false;
  const reader = createBalanceReader({ providers: [{ id: 'A', credential: 'KEY', read: async () => ({ kind: 'ready', amounts: [amountOf('USD', 3)] }) }],
    credentials: { resolve: () => hanging ? new Promise(() => {}) : Promise.resolve({ value: 'SYNTHETIC' }) }, timeoutMs: 15, config: { cacheMs: 0 } });
  await reader.read(); hanging = true; const entry = (await reader.read()).entries[0];
  assert.equal(entry.kind, 'failed'); assert.equal(entry.cachePolicy, 'reset'); assert.equal(entry.amounts, undefined); reader.dispose();
});
test('host stable: MiMo transient errors are distinct from unsupported endpoints and auth denial', async () => {
  const p = PROVIDERS.find(p => p.id === 'xiaomi-mimo');
  const read = status => p.read({ key: 'SYNTHETIC', fetchImpl: async () => ({ ok: false, status }) });
  assert.equal((await read(503)).retryable, true); assert.equal((await read(401)).retryable, false);
  assert.equal((await read(404)).kind, 'unavailable');
});
test('soak: 600 refreshes (50 virtual hours), intermittent failures, no vendor vanishing or timer growth', async () => {
  let round = 0, clock = 0;
  const store = fixture(async () => {
    round++; return reply(['A', 'B', 'C'].map((id, i) => round > 1 && (round + i) % 4 === 0 ? failure(id) : money(id, '$' + i + '.00')));
  }, { now: () => clock });
  for (let i = 0; i < 600; i++) {
    clock = i * 300000; const a = store.refresh(), b = store.refresh(); assert.equal(a, b); await a;
    const rows = store.getSnapshot().entries; assert.deepEqual(rows.map(e => e.id), ['A', 'B', 'C']);
    assert.ok(rows.every(e => e.kind === 'ready'));
    assert.equal(store.state().activeRequests, 0); assert.equal(store.state().timerActive, false);
    for (const row of rows) if (row.stale) assert.ok(clock - row.lastSuccessAt <= 600000);
  }
  assert.equal(round, 600); assert.equal(store.state().requests, 600); store.dispose();
});

test('host stable: a late rejected credential lookup cannot delete a newer identity cache', async () => {
  let resolves = 0, rejectOld, providerCalls = 0;
  const reader = createBalanceReader({ timeoutMs: 15, config: { cacheMs: 10000 },
    credentials: { resolve: () => ++resolves === 2 ? new Promise((_resolve, reject) => { rejectOld = reject; }) :
      Promise.resolve({ value: resolves === 1 ? 'SYNTHETIC_A' : 'SYNTHETIC_B' }) },
    providers: [{ id: 'A', credential: 'KEY', read: async () => { providerCalls++; return { kind: 'ready', amounts: [amountOf('USD', 2)] }; } }] });
  await reader.read(); await reader.read(); const newer = (await reader.read()).entries[0];
  rejectOld(new Error('old lookup failed after its deadline')); await flush();
  const cached = (await reader.read()).entries[0];
  assert.equal(cached.generation, newer.generation); assert.equal(providerCalls, 2); reader.dispose();
});
test('quota stable: hung injected reader finishes and a later warm tick can recover', async () => {
  let tick, calls = 0, signal;
  const quota = summarizeRateLimits({ result: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1900000000 } } } } });
  const runtime = createCodexRuntime({ timeoutMs: 15, warmMs: 30000 }, { timers: { setInterval: fn => { tick = fn; return 1; }, clearInterval: () => {} },
    read: value => { signal = value; return ++calls === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true, source: 'codex-app-server', quota }); } });
  await runtime.start(); assert.equal(signal.aborted, true); assert.equal(runtime.state().running, false);
  tick(); await flush(); assert.equal(runtime.entry().kind, 'ready'); runtime.stop();
});
test('quota stable: repeated HTTP entry reads preserve timestamp, then expire instead of renewing old allowance', async () => {
  let clock = 1000;
  const quota = summarizeRateLimits({ result: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1900000000 } } } } });
  const runtime = createCodexRuntime({ maxStaleMs: 100 }, { now: () => clock, timers: inertTimers,
    read: async () => ({ ok: true, source: 'codex-app-server', quota, readAt: new Date(clock).toISOString() }) });
  await runtime.start(); clock = 1050; assert.equal(runtime.entry().lastSuccessAt, 1000);
  clock = 1090; assert.equal(runtime.entry().lastSuccessAt, 1000); clock = 1101;
  assert.equal(runtime.entry().kind, 'failed'); assert.equal(runtime.entry().amounts, undefined); runtime.stop();
});
test('account stable: the official null grant response clears a previous reading', async () => {
  const environment = createEnvironment(); loadBundle(environment, { source: generateBundleSource() }); const source = environment.factory().accountSource;
  const remote = { account: { getState: async () => ({ ok: true, value: { status: 'credential-stored', links: {}, attempt: null } }),
    getBalance: async () => ({ ok: true, value: null }) } };
  const current = await source.read({ remote }); const result = retainReading(money('deepseek-account'), current, Date.now());
  assert.equal(current.cachePolicy, 'reset'); assert.equal(result.kind, 'unavailable'); assert.equal(result.amounts, undefined);
});
test('account stable: a new sign-in attempt cannot retain the old account on a failed balance read', async () => {
  const environment = createEnvironment(); loadBundle(environment, { source: generateBundleSource() }); const source = environment.factory().accountSource;
  let id = 'synthetic-login-A', success = true;
  const remote = { account: { getState: async () => ({ ok: true, value: { status: 'credential-stored', links: {}, attempt: { id, phase: 'succeeded' } } }),
    getBalance: async () => success ? { ok: true, value: { status: 'ready', value: [{ currency: 'USD', balance: '2' }] } } : { ok: false, error: { code: 'gateway/unavailable' } } } };
  const first = await source.read({ remote }); id = 'synthetic-login-B'; success = false; const next = await source.read({ remote });
  assert.notEqual(next.generation, first.generation); assert.equal(retainReading(first, next).kind, 'failed');
});

test('browser regression: native timers receive their real receiver, not the injected timer bag', async () => {
  const environment = createEnvironment();
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval, originalFetch = globalThis.fetch;
  let setCalls = 0, clearCalls = 0;
  globalThis.setInterval = function() { assert.equal(this, globalThis, 'browser timer receiver'); setCalls++; return 42; };
  globalThis.clearInterval = function() { assert.equal(this, globalThis, 'browser clear receiver'); clearCalls++; };
  globalThis.fetch = async () => reply([money('A')]);
  const fake = createFakeContext({});
  try {
    loadBundle(environment, { source: generateBundleSource() }); const api = environment.factory(); api.apply(fake.context, {});
    const store = fake.registrations[0].definition.inject().store;
    const session = createHookSession(environment.react);
    const view = renderWithHooks(environment.react.createElement(api.RouteBalance, { store }), environment.react, session);
    await store.refresh(); assert.equal(setCalls, 1); assert.match(headlineText(store.getSnapshot()), /\$1\.00/);
    for (const cleanup of view.cleanups) cleanup(); assert.equal(clearCalls, 1);
  } finally { fake.dispose(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; globalThis.fetch = originalFetch; }
});
