// Explicit live check. Requires an operator-provided browser session cookie.
// Never reads credential stores or mints browser authentication grants.
// This is a host + generated-component contract check, not visual browser proof.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesFromHostPayload, headlineText, foldSnapshot } from '../lib/registry.js';
import { createEnvironment, loadBundle, createHookSession, renderWithHooks } from './fake-runtime.mjs';
export async function verifyLive({ host = 'http://127.0.0.1:19387', cookie, fetchImpl = fetch } = {}) {
  const checks = [], check = (name, ok) => checks.push({ name, ok: ok === true });
  const report = { passed: false, mode: 'host-and-generated-component-contract', visualBrowserVerified: false, checks };
  if (typeof cookie !== 'string' || !cookie) return { ...report, unverified: true, reason: 'Set DSH_BROWSER_COOKIE explicitly; no credentials are read automatically.' };
  try {
    const base = new URL(host);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password) throw new Error('local-only');
    const url = new URL('/api/dsh-route-balance/balances', base);
    const response = await fetchImpl(url, { headers: { cookie, origin: base.origin, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    check('authenticated plugin route returns HTTP 200', response.status === 200 && response.ok);
    if (!response.ok || response.status !== 200) return report;
    const payload = await response.json();
    check('host response version and entries shape', payload?.ok === true && payload.version === 1 && Array.isArray(payload.entries) && payload.entries.length > 0);
    if (!checks.at(-1).ok) return report;
    const entries = entriesFromHostPayload(payload);
    check('host entries are not failed or invalid-ready', entries.length === payload.entries.length && entries.every((e) => e.kind !== 'failed'));
    const environment = createEnvironment(); loadBundle(environment); const api = environment.factory();
    const store = api.createStore({ hostSources: api.hostSources, remoteSources: [], metadata: () => ({}), refreshMs: 60000, timers: environment.sandbox,
      fetchImpl: async (relative) => { check('bundle requests the registered endpoint', new URL(relative, base).href === url.href); return { ok: true, status: 200, json: async () => payload }; } });
    await store.refresh(); const session = createHookSession(environment.react);
    const view = renderWithHooks(environment.react.createElement(api.RouteBalance, { store }), environment.react, session);
    const expected = headlineText(foldSnapshot(entries, 0, false));
    report.displayed = view.text.join(''); check('generated widget includes complete host headline', report.displayed === expected);
    for (const cleanup of view.cleanups) cleanup(); store.dispose();
    report.passed = checks.length > 0 && checks.every((c) => c.ok);
  } catch { check('live check completed without connection or protocol error', false); }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyLive({ host: process.env.DSH_RPC_URL, cookie: process.env.DSH_BROWSER_COOKIE });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : report.unverified ? 2 : 1;
}
