/** One activation owns one quota reader. HTTP requests only read its memory. */
import { CODEX_DEFAULTS, describeCodexQuota, failure, readCodexQuotaWithFallback, tightestWindow } from './codex.js';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MAX_STALE_MS } from './registry.js';
export { CODEX_DEFAULTS };
const ID = 'chatgpt-codex', LABEL = 'ChatGPT 订阅';

export function entryFromQuota(result, now = Date.now(), ageMs = 0) {
  const window = tightestWindow(result);
  if (!window) return null;
  const stale = result.stale === true || result.source === 'snapshot';
  // Avoid rounding a nearly-full allowance up to an invented 100%.
  const roundedDown = Math.floor(window.remainingPercent * 100 + 1e-8) / 100;
  const percent = window.remainingPercent > 0 && roundedDown === 0 ? '<0.01' : roundedDown;
  const summary = `ChatGPT 还剩 ${window.remainingPercent}%（${window.windowName}）`;
  const parts = [summary, describeCodexQuota(result)];
  if (window.resetsAt !== null) {
    const date = new Date(window.resetsAt * 1000);
    parts.push(`该窗口重置：${date.toLocaleString('zh-CN', { hour12: false })}`);
    if (date.getTime() <= now) parts.push('重置时刻已过，等待新读数确认');
  }
  if (stale) parts.push(`旧读数，距读取约 ${Math.max(0, Math.floor(ageMs / 1000))} 秒`);
  return { id: ID, label: LABEL, kind: 'ready', amounts: [], short: `GPT 剩 ${percent}%${stale ? '（旧）' : ''}`,
    summary, detail: parts.join(' · '), stale, lastSuccessAt: now - ageMs, at: now - ageMs, ageMs,
    configured: true, topUpUrl: 'https://chatgpt.com/#pricing' };
}
export function createCodexRuntime(raw = {}, deps = {}) {
  const config = { ...CODEX_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['auto', 'snapshot', 'off'].includes(config.strategy)) config.strategy = 'auto';
  const warmMs = typeof config.warmMs === 'number' && Number.isFinite(config.warmMs) ? Math.max(30000, Math.min(Math.floor(config.warmMs), 86400000)) : CODEX_DEFAULTS.warmMs;
  const now = deps.now ?? Date.now, timers = deps.timers ?? { setInterval, clearInterval };
  const maxStaleMs = typeof config.maxStaleMs === 'number' && config.maxStaleMs > 0 ? Math.min(config.maxStaleMs, DEFAULT_MAX_STALE_MS) : DEFAULT_MAX_STALE_MS;
  const timeoutMs = typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? Math.min(config.timeoutMs, 120000) : CODEX_DEFAULTS.timeoutMs;
  let generation = randomUUID();
  let started = false, stopped = false, timer = null, pending = null, controller = null;
  let last = null, lastGood = null, successAt = null, reads = 0, failures = 0;
  const read = deps.read ?? ((signal) => readCodexQuotaWithFallback({ config, spawnImpl: deps.spawnImpl, candidates: deps.candidates,
    env: deps.env, home: deps.home, now, signal, killImpl: deps.killImpl }));
  const tick = () => {
    if (stopped || config.strategy === 'off') return Promise.resolve(null);
    if (pending) return pending;
    controller = new AbortController();
    const signal = controller.signal;
    reads++;
    let deadline, aborted;
    const interrupted = new Promise(resolve => {
      aborted = () => resolve(failure('codex-cancelled'));
      signal.addEventListener('abort', aborted, { once: true });
      deadline = setTimeout(() => { resolve(failure('codex-timeout')); controller?.abort(); }, timeoutMs);
    });
    pending = Promise.race([interrupted, Promise.resolve().then(() => read(signal))]).catch(() => failure('codex-reader-threw')).then((result) => {
      if (stopped) return null;
      if (result?.ok === true && entryFromQuota(result, now())) {
        last = result; lastGood = result;
        const stamp = typeof result.readAt === 'string' ? Date.parse(result.readAt) : NaN;
        successAt = Number.isFinite(stamp) ? Math.min(stamp, now()) : now();
      } else {
        failures++;
        last = failure(result?.ok === true ? 'codex-empty' : result?.reason);
        // Never resurrect another account's cached allowance after sign-out.
        if (['codex-not-signed-in', 'codex-api-key-account'].includes(last.reason)) { lastGood = null; successAt = null; generation = randomUUID(); }
      }
      return last;
    }).finally(() => { clearTimeout(deadline); signal.removeEventListener('abort', aborted); pending = null; controller = null; });
    return pending;
  };
  return {
    start() {
      if (started || stopped || config.strategy === 'off') return pending;
      started = true;
      timer = timers.setInterval(() => { void tick(); }, warmMs);
      timer?.unref?.();
      return tick();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      controller?.abort();
    },
    entry() {
      if (config.strategy === 'off') return null;
      if (lastGood) {
        const age = Math.max(0, now() - successAt);
        if (age > maxStaleMs) return { id: ID, label: LABEL, kind: 'failed', configured: true, generation, detail: '上次读数已过期，等待更新' };
        return { ...entryFromQuota({ ...lastGood, stale: lastGood.stale === true || last?.ok !== true || age > warmMs * 3 }, now(), age), generation };
      }
      if (last === null) return { id: ID, label: LABEL, kind: 'loading', configured: true, generation, detail: '正在读取…' };
      return { id: ID, label: LABEL, kind: 'unavailable', configured: true, generation, cachePolicy: 'reset', detail: describeCodexQuota(last) };
    },
    state: () => ({ started, stopped, running: pending !== null, warmMs, reads, failures, lastSuccessAt: successAt }),
  };
}
