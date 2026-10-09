/** Host-side balances. Only Connection's authenticated /api registry is used. */
import { execFileSync } from 'node:child_process';
import { isNumeric } from './core.js';
import { CODEX_DEFAULTS, createCodexRuntime } from './codex-entry.js';
export const ROUTE_PATH = '/api/dsh-route-balance/balances';
export const DEFAULT_CONFIG = Object.freeze({ refreshMs: 300000, requestTimeoutMs: 15000, cacheMs: 10000,
  zhipuOrigin: 'https://www.bigmodel.cn', extraProviders: [], codex: { ...CODEX_DEFAULTS } });
const SYMBOLS = { CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€', JPY: '¥' };
const numeric = (v) => isNumeric(v) ? Number(v) : null;
export function currencySymbol(currency) { return SYMBOLS[currency] ?? (currency ? `${currency} ` : ''); }
export function amountOf(currency, value) {
  if (typeof currency !== 'string' || !/^[A-Z]{3,8}$/.test(currency) || !isNumeric(value) || Number(value) < 0) return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw) || raw.length > 160) return null;
  const [whole, fraction = ''] = raw.split('.');
  const digits = Number(raw) > 0 && Number(raw) < 0.005 ? 4 : 2;
  let rounded = BigInt(whole + fraction.slice(0, digits).padEnd(digits, '0'));
  if (Number(fraction[digits] ?? 0) >= 5) rounded++;
  const text = rounded.toString().padStart(digits + 1, '0');
  const number = `${text.slice(0, -digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${text.slice(-digits)}`;
  return { currency, text: currencySymbol(currency) + number };
}
function interval(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? Math.min(Math.floor(value), max) : fallback;
}
export function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const x = c.codex && typeof c.codex === 'object' ? c.codex : {};
  let origin = DEFAULT_CONFIG.zhipuOrigin;
  try { const url = new URL(c.zhipuOrigin); if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin; } catch { /* Keep the default. */ }
  return { refreshMs: interval(c.refreshMs, 300000, 60000, 86400000), requestTimeoutMs: interval(c.requestTimeoutMs, 15000, 1000, 120000),
    cacheMs: interval(c.cacheMs, 10000, 0, 300000), zhipuOrigin: origin,
    extraProviders: Array.isArray(c.extraProviders) ? c.extraProviders : [],
    codex: { strategy: ['auto', 'snapshot', 'off'].includes(x.strategy) ? x.strategy : 'auto',
      warmMs: typeof x.warmMs === 'number' && Number.isFinite(x.warmMs) ? Math.max(30000, Math.min(Math.floor(x.warmMs), 86400000)) : CODEX_DEFAULTS.warmMs,
      timeoutMs: interval(x.timeoutMs, 20000, 100, 120000), snapshotPath: typeof x.snapshotPath === 'string' && x.snapshotPath ? x.snapshotPath : null } };
}
const invalidNumbers = () => ({ kind: 'failed', detail: '响应里没有可用的数字' });
const httpFailure = (status) => ({ kind: 'failed', detail: Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP ${status}` : '无效的 HTTP 响应' });
const headers = (key) => ({ authorization: `Bearer ${key}`, accept: 'application/json' });
export const PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', credential: 'OPENROUTER_API_KEY', topUpUrl: 'https://openrouter.ai/settings/credits',
    async read({ key, fetchImpl, signal }) {
      const r = await fetchImpl('https://openrouter.ai/api/v1/credits', { headers: headers(key), signal, redirect: 'error' });
      if (!r.ok) return httpFailure(r.status);
      const body = await r.json(), data = body?.data ?? body;
      const total = numeric(data?.total_credits), used = numeric(data?.total_usage);
      if (total === null || used === null || total < 0 || used < 0 || used > total) return invalidNumbers();
      const amount = amountOf('USD', (total - used).toFixed(4));
      return amount ? { kind: 'ready', amounts: [amount], detail: `共充值 $${total}，已用 $${used.toFixed(4)}` } : invalidNumbers();
    } },
  { id: 'zhipu-glm', label: 'Zhipu GLM', credential: 'ZHIPU_API_KEY', topUpUrl: 'https://www.bigmodel.cn/finance/pay',
    async read({ key, config, fetchImpl, signal }) {
      const r = await fetchImpl(`${config?.zhipuOrigin ?? DEFAULT_CONFIG.zhipuOrigin}/api/biz/account/query-customer-account-report`, { headers: headers(key), signal, redirect: 'error' });
      if (!r.ok) return httpFailure(r.status);
      const body = await r.json();
      if (body?.code !== 200 || !body.data) return { kind: 'failed', detail: '供应商未返回有效的余额响应' };
      const d = body.data, amount = amountOf('CNY', d.availableBalance ?? d.balance);
      if (!amount) return invalidNumbers();
      const parts = [];
      if (isNumeric(d.rechargeAmount)) parts.push(`充值 ${Number(d.rechargeAmount)}`);
      if (isNumeric(d.totalSpendAmount)) parts.push(`已用 ${Number(d.totalSpendAmount)}`);
      return { kind: 'ready', amounts: [amount], detail: parts.join('，') || undefined };
    } },
  { id: 'deepseek-official', label: 'DeepSeek API Key', credential: 'DEEPSEEK_API_KEY', topUpUrl: 'https://platform.deepseek.com/top_up',
    async read({ key, fetchImpl, signal }) {
      const r = await fetchImpl('https://api.deepseek.com/user/balance', { headers: headers(key), signal, redirect: 'error' });
      if (!r.ok) return httpFailure(r.status);
      const body = await r.json(), infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
      const amounts = infos.map((i) => amountOf(i?.currency, i?.total_balance)).filter(Boolean);
      if (!amounts.length) return invalidNumbers();
      const first = infos[0], parts = [];
      if (isNumeric(first?.topped_up_balance)) parts.push(`充值 ${Number(first.topped_up_balance)}`);
      if (isNumeric(first?.granted_balance)) parts.push(`赠送 ${Number(first.granted_balance)}`);
      return { kind: 'ready', amounts, detail: parts.join('，') || undefined };
    } },
  { id: 'xiaomi-mimo', label: 'Xiaomi MiMo', credential: 'MIMO_TOKEN_PLAN_API_KEY', topUpUrl: 'https://mimo.mi.com/',
    async read({ key, fetchImpl, signal }) {
      // These are probes, not a claim that no other public endpoint can exist.
      for (const endpoint of ['usage', 'quota', 'balance']) {
        const r = await fetchImpl(`https://token-plan-cn.xiaomimimo.com/v1/${endpoint}`, { headers: headers(key), signal, redirect: 'error' });
        if (!r.ok) continue;
        const body = await r.json();
        const amount = amountOf(body?.currency ?? 'CNY', body?.data?.balance ?? body?.balance ?? body?.data?.remaining ?? body?.remaining ?? body?.quota?.remaining);
        if (amount) return { kind: 'ready', amounts: [amount] };
      }
      return { kind: 'unavailable', detail: '当前探测的用量接口不可用，请查看供应商控制台' };
    } },
];
// Never serialize error.message, error.name, stderr or credential-store objects.
function safeFailure(error) {
  if (error?.name === 'TimeoutError') return '读取超时，请稍后重试';
  if (error?.name === 'AbortError') return '读取已取消';
  return '余额读取失败，请检查供应商连接和凭据';
}
function publicText(value, keys) {
  if (typeof value !== 'string') return undefined;
  let text = value;
  for (const key of keys) if (key) text = text.split(key).join('[已隐藏]');
  return text.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]').replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, '[本机路径已隐藏]').slice(0, 500);
}
function scrub(value, keys) {
  if (typeof value === 'string') return publicText(value, keys);
  if (Array.isArray(value)) return value.map((v) => scrub(v, keys));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, keys)]));
  return value;
}
async function timed(work, ms, parent) {
  const controller = new AbortController();
  let timer, abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(new DOMException('cancelled', 'AbortError')); };
    parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) abort();
    timer = setTimeout(() => { controller.abort(); reject(new DOMException('timeout', 'TimeoutError')); }, ms);
  });
  try { return await Promise.race([interrupted, Promise.resolve().then(() => { if (controller.signal.aborted) throw new DOMException('cancelled', 'AbortError'); return work(controller.signal); })]); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}
export async function readBalances(deps = {}) {
  const config = normalizeConfig(deps.config), keys = [];
  const providers = [...(deps.providers ?? PROVIDERS), ...config.extraProviders].filter((p) => p && typeof p === 'object' && typeof p.read === 'function');
  const entries = await Promise.all(providers.map(async (provider) => {
    const id = typeof provider.id === 'string' ? provider.id : 'unknown';
    const label = typeof provider.label === 'string' ? provider.label : id;
    const base = { id, label }, started = Date.now();
    try {
      return await timed(async (signal) => {
        let key = null;
        if (provider.credential) {
          if (typeof provider.credential !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(provider.credential)) return { ...base, kind: 'failed', detail: '凭据名称无效' };
          try { key = (await deps.credentials?.resolve?.(provider.credential))?.value ?? null; }
          catch { return { ...base, kind: 'failed', detail: '凭据读取失败，请检查凭据配置' }; }
          if (key === null || key === '') return { ...base, kind: 'unavailable', detail: `本机没有配置 ${provider.credential}`, topUpUrl: provider.topUpUrl };
          if (typeof key !== 'string' || /[\s\x00-\x1f\x7f]/.test(key) || key.length > 16384) return { ...base, kind: 'failed', detail: '凭据格式无效，请重新配置' };
          keys.push(key);
        }
        const result = await provider.read({ key, config, fetchImpl: deps.fetchImpl ?? fetch, signal });
        let kind = ['ready', 'unavailable', 'failed', 'loading'].includes(result?.kind) ? result.kind : 'failed';
        const amounts = Array.isArray(result?.amounts) ? result.amounts.filter((a) => a && typeof a.currency === 'string' && /^[A-Z]{3,8}$/.test(a.currency) && typeof a.text === 'string' && a.text.trim()).map((a) => ({ currency: a.currency, text: a.text })) : [];
        const summary = typeof result?.summary === 'string' && result.summary.trim() ? result.summary : undefined;
        if (kind === 'ready' && !amounts.length && !summary) kind = 'failed';
        return { ...base, kind, amounts: kind === 'ready' ? amounts : null, detail: kind === 'failed' && result?.kind === 'ready' ? '响应里没有可用的数字' : typeof result?.detail === 'string' ? result.detail : undefined,
          ...(summary && kind === 'ready' ? { summary, short: typeof result.short === 'string' ? result.short.slice(0, 16) : undefined } : {}),
          topUpUrl: provider.topUpUrl, ms: Date.now() - started };
      }, interval(deps.timeoutMs, config.requestTimeoutMs, 1, 120000), deps.signal);
    } catch (error) { return { ...base, kind: 'failed', detail: safeFailure(error), ms: Date.now() - started }; }
  }));
  return { ok: true, version: 1, generated: new Date().toISOString(), entries: scrub(entries, keys) };
}
export function createCredentialResolver(ctx, deps = {}) {
  const env = deps.env ?? process.env, platform = deps.platform ?? process.platform;
  return { async resolve(name) {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined;
    const store = ctx?.get?.('credentials') ?? ctx?.credentials;
    // A store denial is not an invitation to bypass it through another source.
    const resolved = await store?.resolve?.(name);
    if (resolved?.value) return resolved;
    if (typeof env[name] === 'string' && env[name].trim()) return { value: env[name], source: 'process-env' };
    if (platform !== 'win32') return undefined;
    let value;
    if (deps.readRegistry) value = deps.readRegistry(name);
    else {
      try { const out = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 5000 }); value = /REG_(?:SZ|EXPAND_SZ)\s+([^\r\n]*)/.exec(out)?.[1]?.trim(); }
      catch { return undefined; }
    }
    return typeof value === 'string' && value.trim() ? { value, source: 'hkcu-environment' } : undefined;
  } };
}
export function apply(ctx, raw, deps = {}) {
  const config = normalizeConfig(raw);
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const runtime = deps.codexRuntime ?? createCodexRuntime(config.codex, deps.codex);
      const lifetime = new AbortController();
      const credentials = deps.credentials ?? createCredentialResolver(scope);
      let cached = null, cachedAt = 0, inFlight = null, disposed = false;
      const read = () => {
        if (cached && Date.now() - cachedAt < config.cacheMs) return Promise.resolve(cached);
        if (inFlight) return inFlight;
        inFlight = readBalances({ credentials, config, providers: deps.providers, fetchImpl: deps.fetchImpl, signal: lifetime.signal })
          .then((body) => { if (!disposed) { cached = body; cachedAt = Date.now(); } return body; })
          .finally(() => { inFlight = null; });
        return inFlight;
      };
      const responseHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
      const dispose = scope.connection.fetch.register({ path: ROUTE_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered',
        async fetch(request) {
          if (disposed) return new Response(null, { status: 503 });
          if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
          if (request.method === 'HEAD') return new Response(null, { status: 200, headers: responseHeaders });
          try {
            const body = await read();
            if (disposed) return new Response(null, { status: 503 });
            const quota = runtime.entry();
            return new Response(JSON.stringify({ ...body, entries: [...body.entries, ...(quota ? [quota] : [])] }), { status: 200, headers: responseHeaders });
          } catch { return new Response(JSON.stringify({ ok: false, error: '读取失败' }), { status: 503, headers: responseHeaders }); }
        } });
      try { runtime.start(); } catch { dispose?.(); lifetime.abort(); runtime.stop(); throw new Error('route-balance: quota runtime could not start'); }
      return () => { disposed = true; lifetime.abort(); runtime.stop(); dispose?.(); cached = null; };
    }, 'route-balance: authenticated route and reader lifetime');
  });
}
export default { apply, PROVIDERS, ROUTE_PATH, createCredentialResolver };
