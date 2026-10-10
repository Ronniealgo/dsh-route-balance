// Falsifiable regressions for the balance-display contract freeze.
//
//   node test/client-regressions.test.mjs
//
// Two layers:
//   1. `lib/registry.js` directly (payload mapping, folding, store),
//   2. the *generated* browser component — `generateBundleSource()` performs
//      the same in-memory transform as `tools/build-client.mjs`, so these cases
//      run against the current template + registry without a rebuild, and the
//      shipped `lib/client.js` is checked for parity separately below.
//
// Every widget assertion reads the mounted component's rendered text, tooltip
// and `data-state`; none of them greps the bundle source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { entriesFromHostPayload, foldSnapshot, headlineText, createStore } from '../lib/registry.js';
import {
  createEnvironment,
  loadBundle,
  generateBundleSource,
  createHookSession,
  renderWithHooks,
  createFakeContext,
  clientBundlePath,
} from '../tools/fake-runtime.mjs';

// ---------------------------------------------------------------------------
// Synthetic host payloads (no live host, no credentials).
// ---------------------------------------------------------------------------

/** Codex-style route: a single quota window; the figure only exists in `short`. */
const QUOTA = { id: 'chatgpt-codex', label: 'ChatGPT 订阅', kind: 'ready', amounts: [], summary: 'ChatGPT 还剩 0%（7 天窗口）', short: 'GPT 剩 0%' };
const MONEY = { id: 'money', label: 'Money', kind: 'ready', amounts: [{ currency: 'CNY', text: '¥1.00' }] };
const LOADING = { id: 'slow-route', label: 'Slow 路由', kind: 'loading' };
const payload = (entries, extra = {}) => ({ ok: true, version: 1, generated: '2026-10-09T00:00:00.000Z', entries, ...extra });

const TIMERS = { setInterval: () => 1, clearInterval: () => {} };

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

/** What the browser actually shows: the figure, the tooltip, and the button state. */
function mountWidget(api, environment, store) {
  const session = createHookSession(environment.react);
  const view = { current: null };
  const rerender = () => {
    view.current = renderWithHooks(environment.react.createElement(api.RouteBalance, { store }), environment.react, session);
  };
  session.rerender = rerender;
  rerender();
  const button = view.current.nodes.find((node) => node.tagName === 'BUTTON');
  return {
    text: view.current.text.join(''),
    title: button.attributes.title,
    state: button.attributes['data-state'],
    dispose() {
      for (const cleanup of view.current.cleanups) cleanup();
      store.dispose();
    },
  };
}

/** The generated component reading whatever `fetchImpl` answers, rendered. */
async function renderHost(entries, answer) {
  const environment = createEnvironment();
  loadBundle(environment, { source: generateBundleSource() });
  const api = environment.factory();
  const store = api.createStore({
    hostSources: api.hostSources,
    remoteSources: [],
    metadata: () => ({}),
    timers: TIMERS,
    refreshMs: 60000,
    fetchImpl: answer ?? (async () => jsonResponse(payload(entries))),
  });
  await store.refresh();
  return mountWidget(api, environment, store);
}

// ---------------------------------------------------------------------------
// 1. Registry mapping / folding / store.
// ---------------------------------------------------------------------------

test('regression: a single-quota route (Codex) reaches the headline alone and mixed with money', () => {
  const alone = foldSnapshot(entriesFromHostPayload(payload([QUOTA])), 0, false);
  assert.equal(alone.kind, 'ready', 'one ready quota makes the surface ready');
  assert.equal(headlineText(alone), 'GPT 剩 0%', 'the figure lives in `short`; dropping it used to leave the entry blank');

  const mixed = foldSnapshot(entriesFromHostPayload(payload([MONEY, QUOTA])), 0, false);
  assert.equal(headlineText(mixed), '¥1.00 · GPT 剩 0%', 'money and a quota share one figure instead of hiding each other');

  const noShort = entriesFromHostPayload(payload([{ id: 'q', label: 'Q', kind: 'ready', amounts: [], summary: '还剩 12%' }]))[0];
  assert.equal(headlineText(foldSnapshot([noShort], 0, false)), '还剩 12%', 'summary carries the figure when short is absent');
});

test('regression: an actual 0% quota is shown, never hidden or rounded away', () => {
  const zero = entriesFromHostPayload(payload([QUOTA]))[0];
  assert.equal(zero.kind, 'ready', 'a real 0% reading is a reading');
  assert.equal(zero.short, 'GPT 剩 0%');
  assert.equal(headlineText(foldSnapshot([zero], 0, false)), 'GPT 剩 0%', '0% must not collapse into 无余额');

  const hardZero = entriesFromHostPayload(payload([{ id: 'm', label: 'M', kind: 'ready', amounts: [{ currency: 'CNY', text: '0%' }] }]))[0];
  assert.deepEqual(hardZero.amounts, [{ currency: 'CNY', text: '0%' }], 'a 0% amount is not filtered out as falsy');
});

test('regression: an invalid ready entry is failed, never a fabricated 0', () => {
  const mapped = entriesFromHostPayload(payload([
    { id: 'empty', label: 'Empty', kind: 'ready', amounts: [] },
    { id: 'blank', label: 'Blank', kind: 'ready', summary: '   ' },
    { id: 'junk', label: 'Junk', kind: 'ready', amounts: [null, 'x', { text: '' }, { currency: 'CNY' }] },
    { id: 'weird', label: 'Weird', kind: 'weird', amounts: [{ currency: 'CNY', text: '¥1.00' }] },
  ]));
  assert.deepEqual(mapped.map((entry) => entry.kind), ['failed', 'failed', 'failed', 'failed']);
  assert.equal(mapped[0].detail, '主机没有返回有效余额或额度');
  assert.equal(mapped[2].detail, '主机没有返回有效余额或额度');
  assert.deepEqual(mapped[2].amounts, [], 'malformed amounts are dropped, not rendered');
  assert.equal(headlineText(foldSnapshot(mapped, 0, false)), '读取失败');
});

test('regression: loading and stale survive the mapping', () => {
  const loading = entriesFromHostPayload(payload([LOADING]))[0];
  assert.equal(loading.kind, 'loading');
  assert.equal(headlineText(foldSnapshot([loading], 0, false)), '读取中…');

  const stale = entriesFromHostPayload(payload([{ ...QUOTA, stale: true }]))[0];
  assert.equal(stale.stale, true, 'the stale flag survives so the widget can mark an old reading');
  assert.equal(stale.summary, QUOTA.summary);
});

test('regression: 401 and 403 report the expired session, other errors report the status', async () => {
  for (const status of [401, 403]) {
    const store = createStore({
      hostSources: [{ id: 'host', label: 'DSH 主机', path: '/api/dsh-route-balance/balances' }],
      remoteSources: [],
      metadata: () => ({}),
      refreshMs: 60000,
      timers: TIMERS,
      fetchImpl: async (url, init) => {
        assert.equal(init.credentials, 'same-origin', 'the route is read with the page session');
        assert.equal(init.headers.accept, 'application/json');
        return { ok: false, status };
      },
    });
    const snapshot = await store.refresh();
    assert.equal(snapshot.entries[0].detail, 'DSH 会话已失效，请刷新页面');
    store.dispose();
  }
  const server = await createStore({
    hostSources: [{ id: 'host', path: '/api/dsh-route-balance/balances' }],
    remoteSources: [],
    metadata: () => ({}),
    refreshMs: 60000,
    timers: TIMERS,
    fetchImpl: async () => ({ ok: false, status: 500 }),
  }).refresh();
  assert.equal(server.entries[0].detail, 'HTTP 500', 'a non-auth error keeps its own status text');
});

// ---------------------------------------------------------------------------
// 2. The generated component.
// ---------------------------------------------------------------------------

test('widget: Codex quota only — the figure is rendered from the host payload', async () => {
  const view = await renderHost([QUOTA]);
  assert.equal(view.state, 'ready');
  assert.equal(view.text, 'GPT 剩 0%', 'before the fix this rendered 无余额: summary/short were dropped');
  assert.match(view.title, /GPT 剩 0%/);
  view.dispose();
});

test('widget: money mixed with a quota shows both, and shows a real 0%', async () => {
  const view = await renderHost([MONEY, QUOTA]);
  assert.equal(view.state, 'ready');
  assert.equal(view.text, '¥1.00 · GPT 剩 0%');
  assert.match(view.title, /¥1\.00/);
  assert.match(view.title, /GPT 剩 0%/);
  view.dispose();
});

test('widget: loading renders 读取中…, stale renders the stale figure', async () => {
  const loading = await renderHost([LOADING, MONEY]);
  assert.equal(loading.text, '¥1.00');
  assert.match(loading.title, /读取中…/);
  loading.dispose();

  const stale = await renderHost([{ ...QUOTA, stale: true, short: 'GPT 剩 0%（旧）' }]);
  assert.equal(stale.state, 'ready');
  assert.equal(stale.text, 'GPT 剩 0%（旧）');
  stale.dispose();
});

test('widget: an invalid ready payload never shows 0%, 100% or ready', async () => {
  const view = await renderHost([
    { id: 'empty', label: 'Empty', kind: 'ready', amounts: [] },
    { id: 'blank', label: 'Blank', kind: 'ready', summary: '  ' },
    { id: 'junk', label: 'Junk', kind: 'ready', amounts: [{ currency: 'CNY' }, null] },
  ]);
  assert.equal(view.state, 'failed');
  assert.equal(view.text, '读取失败');
  assert.doesNotMatch(view.text, /0%|100%/);
  assert.doesNotMatch(view.title, /无余额/, 'a failed reading is not silently a zero balance');
  assert.equal(view.title, '无可用余额', 'error details are not in the simplified tooltip');
  view.dispose();
});

test('widget: an expired browser session is stated in the tooltip', async () => {
  const view = await renderHost([], async () => jsonResponse({ error: 'unauthorized' }, 401));
  assert.equal(view.state, 'failed');
  assert.equal(view.title, '无可用余额', 'error details are not in the simplified tooltip');
  view.dispose();
});

test('widget: a missing account Remote still activates and shows the host routes', async () => {
  const environment = createEnvironment();
  loadBundle(environment, { source: generateBundleSource() });
  const api = environment.factory();
  assert.deepEqual(api.inject, ['slots'], 'no service beyond the slot registry may be a hard dependency');
  assert.ok(!api.inject.includes('remote.account'));
  assert.ok(!api.inject.includes('remote'), 'a service the shell may not provide must not gate activation');

  const fake = createFakeContext({});
  api.apply(fake.context, {});
  assert.equal(fake.registrations.length, 1, 'the widget registers without any account Remote');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(payload([QUOTA]));
  try {
    const props = fake.registrations[0].definition.inject();
    const session = createHookSession(environment.react);
    const view = { current: null };
    const rerender = () => {
      view.current = renderWithHooks(environment.react.createElement(api.RouteBalance, props), environment.react, session);
    };
    session.rerender = rerender;
    rerender();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    rerender();
    const button = view.current.nodes.find((node) => node.tagName === 'BUTTON');
    assert.equal(button.attributes['data-state'], 'ready');
    assert.equal(view.current.text.join(''), 'GPT 剩 0%', 'the API route renders while the account source is unavailable');
    assert.match(button.attributes.title, /GPT 剩/, 'ready host routes are in the tooltip');
    assert.doesNotMatch(button.attributes.title, /此配置未提供账号服务/, 'the simplified tooltip omits error details');
    for (const cleanup of view.current.cleanups) cleanup();
  } finally {
    globalThis.fetch = originalFetch;
    fake.dispose();
  }
});

// ---------------------------------------------------------------------------
// 3. Fail visible: the shell blanks a slot entry whose component throws, so the
//    control must degrade to a readable line instead of disappearing.
// ---------------------------------------------------------------------------

test('widget: a malformed reading shows one readable line instead of blanking the slot', async () => {
  const environment = createEnvironment();
  loadBundle(environment, { source: generateBundleSource() });
  const api = environment.factory();
  const malformed = {
    getSnapshot: () => ({ kind: 'ready', loading: false, entries: [null] }),
    subscribe: () => () => {},
    refresh: async () => {},
    dispose: () => {},
  };
  const session = createHookSession(environment.react);
  const view = renderWithHooks(environment.react.createElement(api.RouteBalance, { store: malformed }), environment.react, session);
  const button = view.nodes.find((node) => node.tagName === 'BUTTON');
  assert.ok(button, 'the control still renders');
  assert.equal(view.text.join(''), '余额显示出错');
  assert.ok(button.attributes.title.length > 0, 'the tooltip shows something readable');
  for (const cleanup of view.cleanups) cleanup();
});

test('widget: a store that throws on read still renders', async () => {
  const environment = createEnvironment();
  loadBundle(environment, { source: generateBundleSource() });
  const api = environment.factory();
  const broken = {
    getSnapshot() { throw new Error('boom'); },
    subscribe() { return () => {}; },
    refresh() { return Promise.resolve(); },
    dispose() {},
  };
  const session = createHookSession(environment.react);
  const view = renderWithHooks(environment.react.createElement(api.RouteBalance, { store: broken }), environment.react, session);
  const button = view.nodes.find((node) => node.tagName === 'BUTTON');
  assert.ok(button, 'the control still renders');
  assert.ok(view.text.join('').length > 0, 'the control says something readable');
  for (const cleanup of view.cleanups) cleanup();
});

test('apply: a context without the Remote service still registers the control', async () => {
  const environment = createEnvironment();
  loadBundle(environment, { source: generateBundleSource() });
  const api = environment.factory();
  const fake = createFakeContext({});
  api.apply(fake.context, {});
  assert.equal(fake.registrations.length, 1, 'the slot registration happens without any Remote namespace');
  fake.dispose();
});

// ---------------------------------------------------------------------------
// 4. The generated component must also exist as the shipped artifact.
// ---------------------------------------------------------------------------

const inMemory = generateBundleSource();
const shipped = fs.readFileSync(clientBundlePath, 'utf8');

test('parity: the shipped lib/client.js is generated from the current sources', () => {
  assert.equal(inMemory, shipped, 'lib/client.js must equal the in-memory generation of src/client.bundle.js + lib/core.js + lib/registry.js');
});
