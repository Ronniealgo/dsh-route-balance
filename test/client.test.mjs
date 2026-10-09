// Test suite for dsh-route-balance.
//   node test/client.test.mjs        (single process, no child processes)
//   node test/host.test.mjs          (the host half's route and adapters)
//
// Layers:
//   1. `lib/core.js`      — formatting and wallet aggregation,
//   2. `lib/registry.js`  — sources, merging, folding, polling,
//   3. `lib/client.js`    — the generated bundle against the shipped
//                           client-module / slot / Remote contracts,
//   4. `apply()` end to end in the fake client runtime, rendering the widget.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as core from '../lib/core.js';
import * as registry from '../lib/registry.js';
import {
  createEnvironment,
  loadBundle,
  createFakeContext,
  createHookSession,
  renderWithHooks,
  PLUGIN_ID,
  packageRoot,
  clientBundlePath,
} from '../tools/fake-runtime.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const bundleSource = fs.readFileSync(clientBundlePath, 'utf8');

/** The live account answers, verified against a running host on 2026-10-09. */
const LIVE_STATE = {
  status: 'credential-stored',
  attempt: null,
  links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
};
const LIVE_BALANCE = {
  status: 'ready',
  value: [{ currency: 'CNY', balance: '16.1447984200000000' }],
  bonusWallets: [{ currency: 'CNY', balance: '0' }],
};

/** The host route payload, recorded from the real adapters on 2026-10-09. */
const HOST_PAYLOAD = {
  ok: true,
  version: 1,
  generated: '2026-10-09T05:00:00.000Z',
  entries: [
    { id: 'openrouter', label: 'OpenRouter', kind: 'ready', amounts: [{ currency: 'USD', text: '$13.14' }], detail: '共充值 $115，已用 $101.8553' },
    { id: 'zhipu-glm', label: 'Zhipu GLM', kind: 'ready', amounts: [{ currency: 'CNY', text: '¥0.10' }], detail: '充值 10，已用 9.9' },
    { id: 'xiaomi-mimo', label: 'Xiaomi MiMo', kind: 'unavailable', detail: '本机没有配置 MIMO_TOKEN_PLAN_API_KEY' },
  ],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

/** fetch stand-in that records every call. */
function fakeFetch(answer) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, init) {
      calls.push({ url, init });
      if (typeof answer === 'function') return answer(url, init);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

/** A remote source stand-in. */
function fakeRemoteSource(id, answers, calls = []) {
  return {
    id,
    label: id,
    async read() {
      calls.push(id);
      const next = answers.length > 0 ? answers.shift() : answers.last;
      answers.last = next;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('core: formats balance strings the way the account page does', () => {
  assert.equal(core.formatAmount('16.1447984200000000'), '16.14');
  assert.equal(core.formatAmount('0'), '0.00');
  assert.equal(core.formatAmount('0E-16'), '0E-16', 'exponent form is not a plain decimal — shown raw');
  assert.equal(core.formatAmount('5.0000000000000000'), '5.00');
  assert.equal(core.formatAmount('0.004'), '0.0040', 'sub-cent remainders keep four decimals');
  assert.equal(core.formatAmount('1234.5'), '1,234.50');
  assert.equal(core.formatAmount('9.999'), '10.00', 'rounds half-up');
  assert.equal(core.formatAmount('1.005'), '1.01');
  assert.equal(core.formatAmount('abc'), 'abc');
  assert.equal(core.currencySymbol('CNY'), '¥');
  assert.equal(core.currencySymbol('XYZ'), 'XYZ ');
});

test('core: rejects values that are not plain decimals', () => {
  assert.equal(core.asNumber('1.5'), 1.5);
  assert.equal(core.asNumber(''), null);
  assert.equal(core.asNumber('NaN'), null);
  assert.equal(core.asNumber('-1'), null, 'balances are non-negative');
  assert.equal(core.isAmount('0'), true);
  assert.equal(core.isAmount('x'), false);
});

test('core: sums wallets per currency and formats them for display', () => {
  assert.deepEqual(core.totalsByCurrency([
    { currency: 'CNY', balance: '1.10' },
    { currency: 'CNY', balance: '2.20' },
    { currency: 'USD', balance: '3.00' },
    { currency: 'CNY', balance: 'n/a' },
  ]), [
    { currency: 'CNY', balance: '3.30000000' },
    { currency: 'USD', balance: '3.00000000' },
  ]);
  assert.deepEqual(core.entryAmounts({ wallets: [{ currency: 'CNY', balance: '0.1' }] }), [{ currency: 'CNY', text: '¥0.10' }]);
  assert.deepEqual(core.headline([{ currency: 'CNY', balance: '1' }, { currency: 'USD', balance: '9' }]), { currency: 'USD', balance: '9.00000000' });
  assert.deepEqual(core.walletsOf([{ currency: 'CNY' }, 'x', { currency: 'CNY', balance: '1' }]), [{ currency: 'CNY', balance: '1' }]);
  assert.equal(core.describeError({ code: 'gateway/cancelled' }), 'gateway/cancelled');
  assert.equal(core.clientMetadata('1', { language: 'zh-CN' }, new Date()).locale, 'zh-CN');
});

test('registry: validates refresh intervals and builds the host URL', () => {
  assert.equal(registry.resolveRefreshMs(undefined, 300000), 300000);
  assert.equal(registry.resolveRefreshMs(120000, 300000), 120000);
  assert.equal(registry.resolveRefreshMs(1000, 300000), 300000, 'floors at one minute');
  assert.equal(registry.hostUrl('', '/api/x'), '/api/x');
  assert.equal(registry.hostUrl('http://127.0.0.1:19387/', '/api/x'), 'http://127.0.0.1:19387/api/x');
  assert.equal(registry.hostUrl('http://h', 'no-slash'), 'http://h/api/dsh-route-balance/balances', 'a bad path falls back to the contract path');
});

test('registry: maps host payloads and refuses to invent one', () => {
  const entries = registry.entriesFromHostPayload(HOST_PAYLOAD);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0].amounts, [{ currency: 'USD', text: '$13.14' }]);
  assert.equal(entries[2].kind, 'unavailable');
  assert.equal(typeof entries[0].at, 'number');

  assert.equal(registry.entriesFromHostPayload(null)[0].kind, 'failed');
  assert.equal(registry.entriesFromHostPayload({ ok: false, error: 'nope' })[0].detail, 'nope');
  assert.equal(registry.entriesFromHostPayload({ ok: true })[0].detail, '主机响应缺少 entries');
  assert.equal(registry.entriesFromHostPayload({ ok: true, entries: [{ id: 'x', kind: 'weird', amounts: 'no' }] })[0].kind, 'failed');
  assert.deepEqual(registry.entriesFromHostPayload({ ok: true, entries: [{ id: 'x', kind: 'ready', amounts: [] }] })[0].amounts, []);
});

test('registry: merges sources, preferring a reading over a non-reading', () => {
  const merged = registry.mergeEntries([
    [{ id: 'deepseek-account', label: 'DeepSeek 账号', kind: 'ready', amounts: [{ currency: 'CNY', text: '¥13.37' }] }],
    [
      { id: 'openrouter', label: 'OpenRouter', kind: 'ready', amounts: [{ currency: 'USD', text: '$13.14' }] },
      { id: 'deepseek-account', label: 'DeepSeek 账号', kind: 'unavailable', detail: 'host does not read this route' },
    ],
  ]);
  assert.deepEqual(merged.map((entry) => entry.id), ['deepseek-account', 'openrouter']);
  assert.equal(merged[0].kind, 'ready', 'the browser-side reading wins over the host placeholder');

  const recovered = registry.mergeEntries([
    [{ id: 'deepseek-account', kind: 'unavailable', detail: 'signed out' }],
    [{ id: 'deepseek-account', kind: 'ready', amounts: [] }],
  ]);
  assert.equal(recovered[0].kind, 'ready', 'a host reading can fill in for a non-reading browser one');
});

test('registry: folds entries into the headline and the tooltip', () => {
  const snapshot = registry.foldSnapshot(registry.entriesFromHostPayload(HOST_PAYLOAD), 5, false);
  assert.equal(snapshot.kind, 'ready');
  assert.equal(registry.headlineText(snapshot), '$13.14 · ¥0.10');
  assert.deepEqual(registry.detailLines(snapshot), [
    'OpenRouter：$13.14',
    '  共充值 $115，已用 $101.8553',
    'Zhipu GLM：¥0.10',
    '  充值 10，已用 9.9',
    'Xiaomi MiMo：本机没有配置 MIMO_TOKEN_PLAN_API_KEY',
    '点击刷新',
  ]);

  const empty = registry.foldSnapshot([], 0, false);
  assert.equal(empty.kind, 'unavailable');
  assert.equal(registry.headlineText(empty), '余额不可用');
  assert.deepEqual(registry.detailLines(empty), ['没有可用的余额来源', '点击刷新']);
  assert.equal(registry.headlineText({ kind: 'loading', entries: [], loading: true }), '读取中…');
  assert.equal(registry.entryLabel({ kind: 'ready', amounts: [] }), '无余额');
});

test('registry: one broken source never takes the others down', async () => {
  const timers = { setInterval: () => 't', clearInterval: () => {} };
  const broken = fakeRemoteSource('broken', [new Error('remote exploded')]);
  const healthy = fakeRemoteSource('healthy', [{ id: 'healthy', label: 'Healthy', kind: 'ready', amounts: [{ currency: 'CNY', text: '¥1.00' }] }]);
  const host = fakeFetch(jsonResponse(HOST_PAYLOAD));
  const store = registry.createStore({
    id: 'test',
    remoteSources: [broken, healthy],
    hostSources: [{ id: 'host-routes', path: '/api/dsh-route-balance/balances' }],
    remote: { account: {} },
    metadata: () => ({}),
    fetchImpl: host.fetchImpl,
    refreshMs: 60000,
    timers,
    now: () => 7,
    log: () => {},
  });
  const unsubscribe = store.subscribe(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.kind, 'ready');
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['broken', 'healthy', 'openrouter', 'zhipu-glm', 'xiaomi-mimo']);
  assert.equal(snapshot.entries.find((entry) => entry.id === 'broken').kind, 'failed');
  assert.equal(snapshot.entries.find((entry) => entry.id === 'broken').detail, '读取失败，请检查连接和账号状态');
  assert.equal(registry.headlineText(snapshot), '¥1.00 · $13.14 · ¥0.10');
  assert.equal(host.calls.length, 1);
  assert.equal(host.calls[0].init.credentials, 'same-origin', 'the host route is called with the page session');
  unsubscribe();
  store.dispose();
});

test('registry: a dead host route is reported, not silently dropped', async () => {
  const timers = { setInterval: () => 't', clearInterval: () => {} };
  const failing = fakeFetch(jsonResponse({ error: 'boom' }, 500));
  const store = registry.createStore({
    id: 'test',
    remoteSources: [fakeRemoteSource('only', [{ id: 'only', label: 'Only', kind: 'ready', amounts: [{ currency: 'CNY', text: '¥2.00' }] }])],
    hostSources: [{ id: 'host-routes', path: '/api/dsh-route-balance/balances' }],
    remote: {},
    metadata: () => ({}),
    fetchImpl: failing.fetchImpl,
    refreshMs: 60000,
    timers,
    now: () => 0,
    log: () => {},
  });
  const unsubscribe = store.subscribe(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  const host = store.getSnapshot().entries.find((entry) => entry.id === 'host-routes');
  assert.equal(host.kind, 'failed');
  assert.equal(host.detail, 'HTTP 500');
  unsubscribe();
  store.dispose();
});

test('registry: polls on the first subscriber, shares one pass, stops on the last', async () => {
  const intervals = new Map();
  let next = 1;
  const timers = {
    setInterval(fn, ms) {
      const id = next++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
  };
  let reads = 0;
  const slow = {
    id: 'slow',
    label: 'Slow',
    async read() {
      reads += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return { id: 'slow', label: 'Slow', kind: 'ready', amounts: [{ currency: 'CNY', text: '¥1.00' }] };
    },
  };
  const store = registry.createStore({ id: 't', remoteSources: [slow], hostSources: [], remote: {}, metadata: () => ({}), refreshMs: 60000, timers, now: () => 0, log: () => {} });
  const unsubscribe = store.subscribe(() => {});
  assert.equal(intervals.size, 1, 'the store starts polling for its first subscriber');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);

  await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(reads, 2, 'concurrent refreshes collapse into one pass');

  unsubscribe();
  assert.equal(intervals.size, 0, 'the last unsubscribe clears the interval');
  store.dispose();
  const settled = store.getSnapshot();
  await store.refresh();
  assert.equal(store.getSnapshot(), settled, 'a disposed store publishes nothing');
});

test('manifest: declares the client half the shipped module system needs', () => {
  assert.equal(pkg.name, PLUGIN_ID);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'lib/index.js');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.equal(pkg.exports['./core'], './lib/core.js');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-renderer']);
  assert.equal(pkg.dsh.bundle.patch, 'cordis.patch.yml');
  assert.equal(pkg.license, 'MIT');
  assert.match(pkg.dsh.engines.dsh, /^>=/);
  for (const file of ['lib/index.js', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(packageRoot, file)), `${file} is missing`);
  }
});

test('bundle: registers exactly the package name the module system resolves', () => {
  const registrations = [...bundleSource.matchAll(/__ModuleLoader__\.load\(\{\n\s*id:/g)];
  assert.equal(registrations.length, 1, 'one facade row and no other loader call');
  assert.match(bundleSource, new RegExp(`id: "${PLUGIN_ID}"`));
  assert.doesNotMatch(bundleSource, /exports\.default\b/, 'the client registry reads named exports');
});

test('bundle: declares its injected services and exports apply/inject', () => {
  assert.match(bundleSource, /const inject = \["slots", "remote"\]/);
  assert.match(bundleSource, /exports\.apply = apply;/);
  assert.match(bundleSource, /exports\.inject = inject;/);
});

test('bundle: requires only platform modules the shell can resolve', () => {
  const environment = createEnvironment();
  loadBundle(environment);
  const exports = environment.factory();
  assert.deepEqual(environment.requiredExternals, ['react', 'react/jsx-runtime']);
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots', 'remote']);
  assert.equal(environment.styles.length, 1, 'the widget stylesheet is injected once');
  assert.equal(environment.styles[0].dataset.plugin, PLUGIN_ID);
  assert.match(environment.styles[0].textContent, /\.dshrb-button/);
  assert.deepEqual(exports.remoteSources.map((source) => source.id), ['deepseek-account']);
  assert.deepEqual(exports.hostSources.map((source) => source.id), ['host-routes']);
  assert.equal(exports.defaults.hostRoute, '/api/dsh-route-balance/balances');
});

test('bundle: the account source maps the live account answers', async () => {
  const environment = createEnvironment();
  loadBundle(environment);
  const exports = environment.factory();
  const source = exports.remoteSources[0];
  assert.equal(source.id, 'deepseek-account');

  const calls = [];
  const ready = await source.read({
    remote: {
      account: {
        getState: async () => ({ ok: true, value: LIVE_STATE }),
        getBalance: async (metadata) => {
          calls.push(metadata);
          return { ok: true, value: LIVE_BALANCE };
        },
      },
    },
  });
  assert.equal(ready.kind, 'ready');
  assert.deepEqual(ready.amounts, [{ currency: 'CNY', text: '¥16.14' }]);
  assert.equal(ready.topUpUrl, LIVE_STATE.links.topUpUrl);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['locale', 'timezoneOffsetSeconds', 'version']);

  const signedOut = await source.read({ remote: { account: { getState: async () => ({ ok: true, value: { status: 'signed-out' } }) } } });
  assert.equal(signedOut.kind, 'unavailable');
  assert.equal(signedOut.detail, '未登录（设置 → 账号）');

  const failed = await source.read({ remote: { account: { getState: async () => ({ ok: false, error: { code: 'gateway/cancelled' } }) } } });
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.detail, 'gateway/cancelled');

  const notReady = await source.read({
    remote: { account: { getState: async () => ({ ok: true, value: LIVE_STATE }), getBalance: async () => ({ ok: true, value: { status: 'failed' } }) } },
  });
  assert.equal(notReady.kind, 'unavailable', 'a null or failed platform answer is never a zero balance');
});

test('bundle: registers the sidebar slot and renders every readable route', async () => {
  const environment = createEnvironment();
  loadBundle(environment);
  const exports = environment.factory();
  const requested = [];
  const fake = createFakeContext({
    account: {
      getState: async () => ({ ok: true, value: LIVE_STATE }),
      getBalance: async () => ({ ok: true, value: LIVE_BALANCE }),
    },
  });
  exports.apply(fake.context);

  assert.deepEqual(fake.injected, ['sidebar.footer.action'], 'default target is the sidebar foot');
  assert.equal(fake.registrations.length, 1);
  const { definition, component } = fake.registrations[0];
  assert.equal(definition.id, 'route-balance');

  // Stub the page fetch so the host route answers the recorded payload.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes('/api/dsh-route-balance/balances')) return jsonResponse(HOST_PAYLOAD);
    return jsonResponse({}, 404);
  };
  try {
    const props = definition.inject();
    const session = createHookSession(environment.react);
    const view = { current: null };
    const rerender = () => {
      view.current = renderWithHooks(environment.react.createElement(component, props), environment.react, session);
    };
    session.rerender = rerender;
    rerender();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    rerender();
    const button = view.current.nodes.find((node) => node.tagName === 'BUTTON');
    assert.equal(button.attributes['data-state'], 'ready');
    assert.deepEqual(view.current.text, ['¥16.14 · $13.14 · ¥0.10'], 'the Remote route and the host routes share one figure');
    assert.match(button.attributes.title, /DeepSeek 账号：¥16\.14/);
    assert.match(button.attributes.title, /OpenRouter：\$13\.14/);
    assert.match(button.attributes.title, /Zhipu GLM：¥0\.10/);
    assert.ok(requested.some((url) => url.includes('/api/dsh-route-balance/balances')), 'the widget asks the host for the other routes');

    for (const cleanup of view.current.cleanups) cleanup();
    fake.dispose();
    assert.equal(environment.intervalIds().length, 0, 'plugin teardown stops the polling timer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bundle: a signed-out account still shows the routes the host can read', async () => {
  const environment = createEnvironment();
  loadBundle(environment);
  const exports = environment.factory();
  const fake = createFakeContext({ account: { getState: async () => ({ ok: true, value: { status: 'signed-out' } }) } });
  exports.apply(fake.context);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ ok: true, version: 1, entries: [{ id: 'openrouter', label: 'OpenRouter', kind: 'ready', amounts: [{ currency: 'USD', text: '$13.14' }] }] });
  try {
    const { definition, component } = fake.registrations[0];
    const props = definition.inject();
    const session = createHookSession(environment.react);
    const view = { current: null };
    const rerender = () => {
      view.current = renderWithHooks(environment.react.createElement(component, props), environment.react, session);
    };
    session.rerender = rerender;
    rerender();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    rerender();
    const button = view.current.nodes.find((node) => node.tagName === 'BUTTON');
    assert.equal(button.attributes['data-state'], 'ready');
    assert.deepEqual(view.current.text, ['$13.14']);
    assert.match(button.attributes.title, /DeepSeek 账号：未登录（设置 → 账号）/);
    for (const cleanup of view.current.cleanups) cleanup();
    fake.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bundle: keeps the row config as the only knob and defaults the rest', () => {
  const environment = createEnvironment();
  loadBundle(environment);
  const exports = environment.factory();
  const remote = { account: { getState: async () => ({ ok: true, value: { status: 'signed-out' } }) } };

  const configured = createFakeContext(remote);
  exports.apply(configured.context, { slot: 'conversation.session.header.actions', refreshMs: 120000 });
  assert.deepEqual(configured.injected, ['conversation.session.header.actions'], 'row config moves the widget');
  configured.dispose();

  const fallback = createFakeContext(remote);
  exports.apply(fallback.context, { slot: '', refreshMs: 1 });
  assert.deepEqual(fallback.injected, ['sidebar.footer.action'], 'invalid config falls back to the sidebar foot');
  assert.equal(exports.defaults.slot, 'sidebar.footer.action');
  assert.equal(exports.defaults.refreshMs, 300000);
  assert.equal(exports.defaults.version, pkg.version);
  fallback.dispose();
});
