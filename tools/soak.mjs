// Real timers + loopback HTTP, synthetic suppliers only. Never accesses accounts.
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createStore } from '../lib/registry.js';
import { amountOf, createBalanceReader } from '../lib/index.js';

const at = process.argv.indexOf('--duration-ms');
const duration = at >= 0 ? Number(process.argv[at + 1]) : 120000;
if (!Number.isFinite(duration) || duration < 500 || duration > 3600000) throw new Error('duration-ms must be 500..3600000');
// Local test HTTP must never be forwarded to an operator's external proxy.
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1,::1';
let round = 0, supplierFailures = 0, hostFailures = 0, observations = 0, peakActiveRequests = 0;
const unhandled = [];
const onUnhandled = () => { unhandled.push('unexpected rejection'); };
process.on('unhandledRejection', onUnhandled);
const reader = createBalanceReader({ config: { cacheMs: 0, requestTimeoutMs: 1000 }, timeoutMs: 35,
  providers: ['A', 'B', 'C'].map((id, i) => ({ id, label: id, async read() {
    if (round > 1 && (round + i) % 7 === 0) { supplierFailures++; return new Promise(() => {}); }
    if (round > 1 && (round + i) % 5 === 0) { supplierFailures++; throw new Error('synthetic supplier disconnect'); }
    return { kind: 'ready', amounts: [amountOf('USD', i)] };
  } })) });
const server = createServer(async (_request, response) => {
  round++;
  if (round > 1 && round % 11 === 0) { hostFailures++; response.writeHead(503); response.end(); return; }
  const body = await reader.read();
  if (!response.destroyed) { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let activeFetches = 0;
const store = createStore({ hostSources: [{ id: 'vendors', url: base + '/balance' }], fetchImpl: async (...args) => {
    activeFetches++; peakActiveRequests = Math.max(peakActiveRequests, activeFetches);
    try { return await globalThis.fetch(...args); } finally { activeFetches--; }
  }, requestTimeoutMs: 250,
  timers: { setInterval: fn => globalThis.setInterval(fn, 150), clearInterval: id => globalThis.clearInterval(id) } });
let seenAll = false, missingAfterSuccess = false, checkError = null;
const unsubscribe = store.subscribe(() => {
  observations++;
  peakActiveRequests = Math.max(peakActiveRequests, store.state().activeRequests);
  const rows = store.getSnapshot().entries;
  if (rows.length === 3 && rows.every(e => e.kind === 'ready')) seenAll = true;
  if (seenAll && (rows.length !== 3 || rows.some(e => e.kind !== 'ready' || !e.amounts?.length))) missingAfterSuccess = true;
  for (const row of rows) if (row.kind === 'ready' && row.stale && !Number.isFinite(row.lastSuccessAt)) checkError = 'missing freshness timestamp';
});
const manual = setInterval(() => { void store.refresh(); }, 475);
try {
  await new Promise(resolve => setTimeout(resolve, duration));
  clearInterval(manual); unsubscribe(); store.dispose(); reader.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(seenAll, true, 'all synthetic suppliers produced an initial value');
  assert.equal(missingAfterSuccess, false, 'one transient fault must not remove a supplier');
  assert.equal(checkError, null); assert.deepEqual(unhandled, []);
  assert.equal(store.state().activeRequests, 0); assert.equal(store.state().timerActive, false);
  assert.ok(peakActiveRequests <= 1, 'browser must coalesce concurrent host reads');
  console.log(JSON.stringify({ passed: true, durationMs: duration, rounds: round, observations, supplierFailures, hostFailures,
    missingAfterSuccess, peakActiveRequests, timersStopped: !store.state().timerActive, activeRequestsAfterStop: store.state().activeRequests,
    boundary: 'synthetic suppliers, real timers and loopback HTTP; no real accounts or GUI' }, null, 2));
} finally {
  clearInterval(manual); unsubscribe(); store.dispose(); reader.dispose();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); process.off('unhandledRejection', onUnhandled);
}
