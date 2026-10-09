// Synthetic dependencies only: never starts Codex or reads real credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountOf, apply, currencySymbol, normalizeConfig, PROVIDERS, readBalances, ROUTE_PATH, createCredentialResolver } from '../lib/index.js';
const creds = (value = 'FAKE_TEST_KEY') => ({ resolve: async () => ({ value }) });
const answer = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const one = async (provider, body, key) => (await readBalances({ providers: [provider], credentials: creds(key), fetchImpl: answer(body) })).entries[0];

test('amount formatting preserves zero, rounding and sub-cent values without coercion', () => {
  assert.equal(currencySymbol('XYZ'), 'XYZ ');
  for (const [value, expected] of [['0.1', '¥0.10'], ['0.004', '¥0.0040'], [0, '¥0.00'], ['1234.567', '¥1,234.57']]) assert.equal(amountOf('CNY', value).text, expected);
  for (const value of [null, undefined, '', ' ', true, false, [], {}, NaN, Infinity, -1, 'secret']) assert.equal(amountOf('CNY', value), null);
});
test('config: fixed path, known keys only, safe timeouts and no credential-bearing origin', () => {
  const config = normalizeConfig({ path: '/evil', unknown: true, requestTimeoutMs: 5, zhipuOrigin: 'https://user:pass@example.test', codex: { strategy: 'mistake', warmMs: 1 } });
  assert.equal(config.path, undefined); assert.equal(config.unknown, undefined);
  assert.equal(config.requestTimeoutMs, 15000); assert.equal(config.codex.strategy, 'auto'); assert.equal(config.codex.warmMs, 30000);
  assert.equal(config.zhipuOrigin, 'https://www.bigmodel.cn');
});
test('real provider response shapes with synthetic values map to amounts', async () => {
  const openrouter = await one(PROVIDERS[0], { data: { total_credits: 10, total_usage: 2.5 } });
  assert.equal(openrouter.kind, 'ready'); assert.equal(openrouter.amounts[0].text, '$7.50');
  const zhipu = await one(PROVIDERS[1], { code: 200, data: { availableBalance: 0, rechargeAmount: 2, totalSpendAmount: 2 } });
  assert.equal(zhipu.kind, 'ready'); assert.equal(zhipu.amounts[0].text, '¥0.00');
});
for (const bad of [null, undefined, '', ' ', true, false, [], {}, 'bad', Infinity]) {
  test(`F3 OpenRouter rejects non-numeric ${JSON.stringify(bad)}`, async () => {
    const entry = await one(PROVIDERS[0], { data: { total_credits: bad, total_usage: false } });
    assert.equal(entry.kind, 'failed'); assert.equal(entry.amounts, null);
  });
}
test('all adapters reject invalid amounts; no ready+[null]', async () => {
  assert.equal((await one(PROVIDERS[1], { code: 200, data: { balance: false } })).kind, 'failed');
  assert.equal((await one(PROVIDERS[2], { balance_infos: [{ currency: 'CNY', total_balance: null }] })).kind, 'failed');
  assert.equal((await one(PROVIDERS[3], { balance: false })).kind, 'unavailable');
  assert.equal((await one(PROVIDERS[0], { data: { total_credits: 1, total_usage: 2 } })).kind, 'failed');
});
test('C2 exceptions, including credential-store exceptions, never reach the response', async () => {
  const secret = 'SYNTHETIC_SECRET_abcdef';
  const throwing = { resolve: async () => { throw new Error(`Bearer ${secret} C:\\private\\auth.json`); } };
  const body = await readBalances({ credentials: throwing });
  assert.ok(body.entries.every((e) => e.kind === 'failed'));
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC|private|Bearer/);
  const failed = await readBalances({ providers: [{ id: 'boom', credential: 'KEY', read() { throw new Error(secret); } }], credentials: creds(secret) });
  assert.doesNotMatch(JSON.stringify(failed), /SYNTHETIC/);
  assert.equal(failed.entries[0].kind, 'failed');
});
test('C2 multiline keys fail before any fetch (original Node Header error counterexample)', async () => {
  let calls = 0;
  const body = await readBalances({ credentials: creds('SYNTHETIC_KEY\nINVALID'), fetchImpl() { calls++; throw new Error('must not call'); } });
  assert.equal(calls, 0); assert.ok(body.entries.every((e) => e.kind === 'failed'));
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_KEY|INVALID/);
});
test('C2 known keys are removed from adapter metadata and success payloads too', async () => {
  const secret = 'SYNTHETIC_VALID_KEY';
  const body = await readBalances({ credentials: creds(secret), providers: [{ id: 'extra', label: 'Extra', credential: 'KEY', read: async () => ({ kind: 'ready', amounts: [{ currency: 'USD', text: '$1.00' }], detail: secret }) }] });
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_VALID_KEY/);
});
test('empty ready responses fail; valid extra adapters and HTTP statuses remain useful', async () => {
  const bad = await readBalances({ providers: [{ id: 'bad', read: () => ({ kind: 'ready', amounts: [null] }) }] });
  assert.equal(bad.entries[0].kind, 'failed');
  const extra = await readBalances({ providers: [], config: { extraProviders: [{ id: 'q', read: () => ({ kind: 'ready', summary: 'Quota', short: 'Q' }) }] } });
  assert.equal(extra.entries[0].summary, 'Quota');
  assert.equal((await readBalances({ providers: [PROVIDERS[0]], credentials: creds(), fetchImpl: answer({}, 401) })).entries[0].detail, 'HTTP 401');
  const absent = await readBalances({ credentials: { resolve: async () => undefined } });
  assert.ok(absent.entries.every((e) => e.kind === 'unavailable'));
});
test('a stalled adapter is bounded even if it ignores AbortSignal', async () => {
  let signal;
  const body = await readBalances({ providers: [{ id: 'hang', read: (deps) => { signal = deps.signal; return new Promise(() => {}); } }], timeoutMs: 15 });
  assert.equal(body.entries[0].kind, 'failed'); assert.equal(signal.aborted, true);
});
test('credential lookup has an injected registry seam and fails closed on store denial', async () => {
  let registryCalls = 0;
  const resolver = createCredentialResolver({}, { env: {}, platform: 'win32', readRegistry: () => { registryCalls++; return 'FAKE'; } });
  assert.equal((await resolver.resolve('VALID_NAME')).source, 'hkcu-environment');
  assert.equal(await resolver.resolve('BAD&COMMAND'), undefined); assert.equal(registryCalls, 1);
  const denied = createCredentialResolver({ credentials: { resolve() { throw new Error('denied'); } } }, { env: { KEY: 'FAKE' }, platform: 'linux' });
  await assert.rejects(() => denied.resolve('KEY'), /denied/);
});
function fixture(config = {}, deps = {}) {
  const routes = [], cleanups = []; let starts = 0, stops = 0, removed = 0;
  const runtime = { start() { starts++; }, stop() { stops++; }, entry: () => ({ id: 'chatgpt-codex', kind: 'ready', summary: 'ChatGPT 还剩 0%', short: 'GPT 剩 0%', amounts: [] }) };
  const scope = { connection: { fetch: { register(route) { routes.push(route); return () => removed++; } } }, effect(factory) { cleanups.push(factory()); } };
  const ctx = { inject(names, callback) { assert.deepEqual(names, ['connection']); callback(scope); } };
  apply(ctx, config, { credentials: creds(), providers: [], codexRuntime: runtime, ...deps });
  return { route: routes[0], routes, dispose() { for (const fn of cleanups) fn(); }, counts: () => ({ starts, stops, removed }) };
}
test('C1 uses only the authenticated Connection registry and fixed route', async () => {
  const f = fixture({ path: '/other' });
  assert.equal(f.routes.length, 1); assert.equal(f.route.path, ROUTE_PATH); assert.deepEqual(f.route.methods, ['GET', 'HEAD']);
  const response = await f.route.fetch(new Request(`http://localhost${ROUTE_PATH}`));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json(); assert.equal(body.entries[0].short, 'GPT 剩 0%');
  f.dispose(); assert.deepEqual(f.counts(), { starts: 1, stops: 1, removed: 1 });
  assert.equal((await f.route.fetch(new Request(`http://localhost${ROUTE_PATH}`))).status, 503);
});
test('HEAD and unsupported methods do not trigger provider work; GET requests single-flight', async () => {
  let calls = 0, release;
  const f = fixture({}, { providers: [{ id: 'one', read: () => { calls++; return new Promise((resolve) => { release = () => resolve({ kind: 'ready', amounts: [amountOf('USD', 1)] }); }); } }] });
  const request = (method) => new Request(`http://localhost${ROUTE_PATH}`, { method });
  assert.equal((await f.route.fetch(request('HEAD'))).status, 200);
  assert.equal((await f.route.fetch(request('POST'))).status, 405); assert.equal(calls, 0);
  const pending = [f.route.fetch(request('GET')), f.route.fetch(request('GET')), f.route.fetch(request('GET'))];
  await new Promise(setImmediate); assert.equal(calls, 1); release();
  for (const response of await Promise.all(pending)) assert.equal(response.status, 200);
  await f.route.fetch(request('GET')); assert.equal(calls, 1); f.dispose();
});
test('disposal cancels in-flight provider work and does not return stale successful response', async () => {
  let signal;
  const f = fixture({}, { providers: [{ id: 'hang', read: (x) => { signal = x.signal; return new Promise(() => {}); } }] });
  const pending = f.route.fetch(new Request(`http://localhost${ROUTE_PATH}`));
  await new Promise(setImmediate); f.dispose();
  assert.equal(signal.aborted, true); assert.equal((await pending).status, 503);
});
