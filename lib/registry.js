/** Pure source model and bounded, activation-local browser polling. */
import { describeError, entryAmounts, unavailableEntry } from "./core.js";

export const DEFAULT_MAX_STALE_MS = 86400000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export function resolveRefreshMs(value, fallback = 300000) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 60000 ? Math.min(Math.floor(ms), 86400000) : fallback;
}
export function hostUrl(base, path) {
  const root = typeof base === "string" && base !== "" ? base : "";
  const route = typeof path === "string" && path.startsWith("/") ? path : "/api/dsh-route-balance/balances";
  return root.replace(/\/$/, "") + route;
}
const bounded = (value, fallback) => typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : fallback;
const stamp = (entry, now) => {
  const value = entry?.lastSuccessAt ?? entry?.at;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(value, now) : now;
};
export function hasReading(entry) {
  if (!entry || entry.kind !== "ready") return false;
  return (Array.isArray(entry.amounts) && entry.amounts.some(a => a && typeof a.text === "string" && a.text.trim())) ||
    (typeof entry.summary === "string" && entry.summary.trim() !== "") || entryAmounts(entry).length > 0;
}

/** Retain only an explicitly labelled, time-bounded reading of the same identity. */
export function retainReading(previous, current, now = Date.now(), maxStaleMs = DEFAULT_MAX_STALE_MS) {
  if (hasReading(current)) {
    const lastSuccessAt = stamp(current, now), ageMs = Math.max(0, now - lastSuccessAt);
    if (current.stale === true && ageMs > maxStaleMs) return { id: current.id, label: current.label, kind: "failed",
      configured: current.configured, generation: current.generation, known: true, detail: "上次读数已过期，等待更新" };
    return { ...current, lastSuccessAt, stale: current.stale === true, ageMs };
  }
  const reset = current?.kind === "unavailable" || current?.retryable === false || current?.cachePolicy === "reset" ||
    (previous?.generation !== undefined && current?.generation !== undefined && previous.generation !== current.generation);
  if (!reset && hasReading(previous) && ["failed", "loading"].includes(current?.kind)) {
    const lastSuccessAt = stamp(previous, now), ageMs = Math.max(0, now - lastSuccessAt);
    if (ageMs <= maxStaleMs) return { ...previous, label: current.label ?? previous.label, stale: true,
      lastSuccessAt, ageMs, lastError: current.detail, refreshing: current.kind === "loading" };
    return { ...current, known: true, detail: "上次读数已过期，等待更新" };
  }
  return { ...current, ...(previous ? { known: true } : {}) };
}

/** Validate the host boundary; never silently drop malformed inventory rows. */
export function entriesFromHostPayload(payload, at = Date.now()) {
  const failed = detail => [{ id: "host", label: "DSH 主机", kind: "failed", amounts: [], detail, at }];
  if (payload === null || typeof payload !== "object") return failed("主机返回了非 JSON 内容");
  if (payload.ok === false) return failed(typeof payload.error === "string" ? payload.error.slice(0, 300) : "主机报告失败");
  if (!Array.isArray(payload.entries)) return failed("主机响应缺少 entries");
  if (payload.ok !== true || payload.version !== 1) return failed("主机响应版本或状态无效");
  if (payload.entries.some(e => !e || typeof e !== "object" || typeof e.id !== "string" || !e.id)) return failed("主机响应条目无效");
  return payload.entries.map(entry => {
    let kind = ["ready", "unavailable", "loading", "failed"].includes(entry.kind) ? entry.kind : "failed";
    const amounts = Array.isArray(entry.amounts) ? entry.amounts.filter(a => a && typeof a.currency === "string" &&
      /^[A-Z]{3,8}$/.test(a.currency) && typeof a.text === "string" && a.text.trim()).map(a => ({ currency: a.currency, text: a.text.slice(0, 180) })) : [];
    const summary = typeof entry.summary === "string" && entry.summary.trim() ? entry.summary.slice(0, 300) : undefined;
    if (kind === "ready" && !amounts.length && !summary) kind = "failed";
    const mapped = { id: entry.id, label: typeof entry.label === "string" && entry.label ? entry.label.slice(0, 120) : entry.id, kind, amounts, at };
    if (summary) mapped.summary = summary;
    if (typeof entry.short === "string" && entry.short.trim()) mapped.short = entry.short.slice(0, 80);
    if (entry.stale === true) mapped.stale = true;
    if (typeof entry.lastSuccessAt === "number" && Number.isFinite(entry.lastSuccessAt)) mapped.lastSuccessAt = Math.min(entry.lastSuccessAt, at);
    if (typeof entry.generation === "string") mapped.generation = entry.generation.slice(0, 120);
    if (typeof entry.retryable === "boolean") mapped.retryable = entry.retryable;
    if (entry.cachePolicy === "reset") mapped.cachePolicy = "reset";
    if (typeof entry.configured === "boolean") mapped.configured = entry.configured;
    if (typeof entry.detail === "string" && entry.detail) mapped.detail = entry.detail.slice(0, 500);
    if (kind === "failed" && entry.kind === "ready") mapped.detail = "主机没有返回有效余额或额度";
    if (typeof entry.topUpUrl === "string") mapped.topUpUrl = entry.topUpUrl;
    if (typeof entry.ms === "number") mapped.ms = entry.ms;
    return mapped;
  });
}

/** A fresh success outranks a stale fallback, regardless of source order. */
export function mergeEntries(groups) {
  const byId = new Map(), order = [];
  for (const group of groups) for (const entry of Array.isArray(group) ? group : []) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
    const existing = byId.get(entry.id);
    if (!existing) { byId.set(entry.id, entry); order.push(entry.id); }
    else if ((existing.kind !== "ready" && entry.kind === "ready") ||
      (existing.kind === "ready" && existing.stale === true && entry.kind === "ready" && entry.stale !== true)) byId.set(entry.id, entry);
  }
  return order.map(id => byId.get(id));
}
export function entryLabel(entry) {
  if (!entry) return "读取失败";
  if (entry.kind === "ready") {
    const amounts = Array.isArray(entry.amounts) && entry.amounts.length ? entry.amounts.filter(Boolean).map(a => a.text).join(" + ") : entryAmounts(entry).map(a => a.text).join(" + ");
    const value = typeof entry.short === "string" && entry.short.trim() ? entry.short :
      typeof entry.summary === "string" && entry.summary.trim() ? entry.summary : amounts || "无余额";
    return entry.stale === true && !/（旧）|（上次）/.test(value) ? value + "（上次）" : value;
  }
  if (entry.kind === "unavailable") return "不可用";
  if (entry.kind === "loading") return "读取中…";
  return "读取失败";
}
export function foldSnapshot(entries, at, loading) {
  const list = Array.isArray(entries) ? entries.filter(e => e && typeof e === "object") : [];
  const usable = list.filter(e => e.kind === "ready" || e.kind === "failed");
  return { kind: list.some(e => e.kind === "ready") ? "ready" : usable.length === 0 ? "unavailable" : "failed",
    at, entries: list, loading: loading === true || list.some(e => e.kind === "loading") };
}
export function headlineText(snapshot) {
  const parts = [];
  for (const entry of snapshot?.entries ?? []) {
    if (entry?.kind !== "ready") continue;
    const text = entryLabel(entry);
    if (text !== "无余额" || parts.length === 0) parts.push(text);
  }
  if (parts.length) return parts.join(" · ");
  if (snapshot?.loading) return "读取中…";
  if (snapshot?.kind === "unavailable") return "余额不可用";
  return snapshot?.kind === "failed" ? "读取失败" : "无余额";
}
export function detailLines(snapshot, options = {}) {
  const lines = [];
  for (const entry of snapshot?.entries ?? []) {
    if (!entry) continue;
    const label = entry.label ?? entry.id;
    if (entry.kind === "ready") {
      lines.push(label + "：" + entryLabel(entry));
      for (const wallet of entry.bonusWallets ?? []) {
        const amount = Number(wallet?.balance);
        if (Number.isFinite(amount) && amount > 0) lines.push("  赠送 " + (wallet.currency ?? "") + " " + wallet.balance);
      }
      if (entry.detail) lines.push("  " + entry.detail);
    } else lines.push(label + "：" + (entry.kind === "loading" ? "读取中…" : entry.detail ?? (entry.kind === "unavailable" ? "此环境不可用" : "读取失败")));
  }
  if (!lines.length) lines.push(options.itemLabel ?? "没有可用的余额来源");
  lines.push(options.hint ?? "点击刷新");
  return lines;
}

/** One value per line, one blank line between routes. Statuses must not hide a route. */
export function balanceTooltip(snapshot) {
  const groups = [];
  for (const entry of snapshot?.entries ?? []) {
    if (!entry || (entry.configured === false && entry.kind !== "failed" && entry.known !== true)) continue;
    const prefix = String(entry.label ?? entry.id ?? "余额").trim() + "：";
    if (entry.kind === "ready") {
      const amounts = Array.isArray(entry.amounts) ? entry.amounts.filter(a => a && typeof a.text === "string" && a.text.trim()) : [];
      const values = amounts.length ? amounts.map(a => a.text) : [entryLabel(entry)];
      const suffix = entry.stale === true ? "（上次）" : "";
      groups.push(values.filter(Boolean).map(value => prefix + value + (suffix && !/（旧）|（上次）/.test(value) ? suffix : "")).join("\n"));
    } else if (entry.kind === "loading") groups.push(prefix + "读取中…");
    else if (entry.kind === "failed" || entry.known === true || entry.configured === true) groups.push(prefix +
      (entry.kind === "failed" && (entry.retryable === false || entry.cachePolicy === "reset") ? "需重新登录或配置" : "暂不可用"));
  }
  return groups.filter(Boolean).join("\n\n") || "无可用余额";
}

/** Independent sources, bounded requests, incremental updates and abortable lifecycle. */
export function createStore(deps = {}) {
  const remoteSources = (deps.remoteSources ?? []).filter(s => s && typeof s.read === "function");
  const hostSources = (deps.hostSources ?? []).filter(s => s && (typeof s.read === "function" || typeof s.path === "string" || typeof s.url === "string"));
  const sources = [...remoteSources.map((source, i) => ({ key: `remote:${i}`, source, type: "remote" })),
    ...hostSources.map((source, i) => ({ key: `host:${i}`, source, type: "host" }))];
  const refreshMs = resolveRefreshMs(deps.refreshMs, deps.fallbackRefreshMs ?? 300000);
  const requestTimeoutMs = bounded(deps.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const maxStaleMs = bounded(deps.maxStaleMs, DEFAULT_MAX_STALE_MS);
  const timers = deps.timers ?? { setInterval: (...args) => globalThis.setInterval(...args), clearInterval: (...args) => globalThis.clearInterval(...args) };
  const timeouts = deps.timeouts ?? { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (...args) => globalThis.clearTimeout(...args) };
  const now = deps.now ?? Date.now, fetchImpl = deps.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const id = typeof deps.id === "string" && deps.id ? deps.id : "route-balance";
  const records = new Map(sources.map(d => [d.key, { entries: [], good: new Map() }]));
  const listeners = new Set();
  let snapshot = foldSnapshot([], 0, true), timer = null, inFlight = null, run = null, epoch = 0, paused = false, disposed = false;
  let cycles = 0, requests = 0, deadlineFailures = 0;
  const log = (...args) => { try { deps.log?.(...args); } catch { /* Logging cannot break polling. */ } };
  const publish = refreshing => {
    const at = now();
    const entries = mergeEntries(sources.map(d => records.get(d.key).entries)).map(entry => {
      if (!hasReading(entry)) return entry;
      const age = Math.max(0, at - stamp(entry, at));
      return retainReading(undefined, { ...entry, stale: entry.stale === true || age > refreshMs * 3 }, at, maxStaleMs);
    });
    const loading = refreshing && !entries.some(hasReading) && (run?.controllers.size ?? 0) > 0;
    snapshot = { ...foldSnapshot(entries, at, loading), refreshing, stale: entries.some(e => e.stale === true) };
    for (const listener of listeners) { try { listener(); } catch { log(`[${id}] listener failed`); } }
  };
  const failureEntry = (source, detail, reset = false) => ({ id: source.id ?? "source", label: source.label ?? source.id ?? "余额",
    kind: "failed", detail, at: now(), ...(reset ? { retryable: false, cachePolicy: "reset" } : {}) });
  const readSource = async (descriptor, signal) => {
    const source = descriptor.source;
    if (typeof source.read === "function") {
      const result = await source.read({ remote: deps.remote, metadata: deps.metadata?.() ?? {}, fetchImpl, signal, log });
      const entries = Array.isArray(result) ? result : [result];
      if (entries.some(e => !e || typeof e !== "object" || typeof e.id !== "string")) throw new Error("invalid source result");
      return { entries: entries.map(e => ({ at: now(), ...e })), authoritative: true };
    }
    const response = await fetchImpl(source.url ?? hostUrl(deps.hostBase, source.path), {
      headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal,
    });
    if (!response.ok) {
      const reset = response.status === 401 || response.status === 403;
      return { entries: [failureEntry(source, reset ? "DSH 会话已失效，请刷新页面" : `HTTP ${response.status}`, reset)], authoritative: false, reset };
    }
    const body = await response.json();
    const authoritative = body?.ok === true && body.version === 1 && Array.isArray(body.entries) &&
      body.entries.every(e => e && typeof e === "object" && typeof e.id === "string" && e.id);
    return { entries: entriesFromHostPayload(body, now()), authoritative };
  };
  const reconcile = (descriptor, result) => {
    const record = records.get(descriptor.key);
    let incoming = result.entries;
    if (!result.authoritative && record.entries.length) {
      const failure = incoming[0];
      incoming = record.entries.map(e => ({ id: e.id, label: e.label, kind: "failed", detail: failure.detail,
        configured: e.configured, at: now(), ...(result.reset ? { retryable: false, cachePolicy: "reset" } : {}) }));
    }
    if (result.reset) record.good.clear();
    if (result.authoritative) {
      const ids = new Set(incoming.map(e => e.id));
      for (const key of record.good.keys()) if (!ids.has(key)) record.good.delete(key);
    }
    record.entries = incoming.map(entry => {
      const previous = record.good.get(entry.id);
      const changed = previous?.generation !== undefined && entry.generation !== undefined && previous.generation !== entry.generation;
      if (entry.kind === "unavailable" || entry.retryable === false || entry.cachePolicy === "reset" || changed) record.good.delete(entry.id);
      const next = retainReading(changed ? undefined : previous, entry, now(), maxStaleMs);
      if (hasReading(next)) record.good.set(entry.id, next);
      return next;
    });
  };
  const stopTimer = () => { if (timer !== null) { timers.clearInterval(timer); timer = null; } };
  const cancelRun = () => { epoch++; const old = run; run = null; inFlight = null; for (const controller of old?.controllers ?? []) controller.abort(); };
  const read = () => {
    if (disposed || paused) return Promise.resolve(snapshot);
    if (inFlight) return inFlight;
    const current = { epoch: ++epoch, controllers: new Set() };
    run = current; cycles++;
    inFlight = Promise.resolve().then(async () => {
      const pending = sources.map(async descriptor => {
        const controller = new AbortController();
        current.controllers.add(controller); requests++;
        let deadline, onAbort;
        const interrupted = new Promise((_, reject) => {
          onAbort = () => reject(new DOMException("cancelled", "AbortError"));
          controller.signal.addEventListener("abort", onAbort, { once: true });
          deadline = timeouts.setTimeout(() => {
            deadlineFailures++;
            reject(new DOMException("timeout", "TimeoutError"));
            controller.abort();
          }, requestTimeoutMs);
        });
        let result;
        try {
          result = await Promise.race([interrupted, Promise.resolve().then(() => {
            if (controller.signal.aborted || disposed || current.epoch !== epoch) throw new DOMException("cancelled", "AbortError");
            return readSource(descriptor, controller.signal);
          })]);
        } catch (error) {
          result = { entries: [failureEntry(descriptor.source, describeError(error))], authoritative: false };
        } finally {
          timeouts.clearTimeout(deadline);
          controller.signal.removeEventListener("abort", onAbort);
          current.controllers.delete(controller);
        }
        if (!disposed && current.epoch === epoch) { reconcile(descriptor, result); publish(true); }
      });
      if (!disposed && current.epoch === epoch) publish(true);
      await Promise.all(pending);
      if (!disposed && current.epoch === epoch) publish(false);
      return snapshot;
    }).finally(() => { if (run === current) { run = null; inFlight = null; } });
    return inFlight;
  };
  const startTimer = () => {
    if (disposed || paused || !listeners.size || timer !== null) return;
    timer = timers.setInterval(() => { void read().catch(() => log(`[${id}] refresh failed`)); }, refreshMs);
    timer?.unref?.();
  };
  return {
    id, refreshMs, sourceIds: sources.map(d => d.source.id ?? "source"), getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed || typeof listener !== "function") return () => {};
      listeners.add(listener); startTimer(); void read().catch(() => log(`[${id}] refresh failed`));
      return () => { listeners.delete(listener); if (!listeners.size) { stopTimer(); cancelRun(); } };
    },
    refresh: read,
    pause() {
      if (disposed) return;
      paused = true; stopTimer(); cancelRun();
      for (const record of records.values()) record.entries = record.entries.map(entry => hasReading(entry) ? { ...entry, stale: true } : entry);
      publish(false);
    },
    resume() { if (disposed) return Promise.resolve(snapshot); paused = false; startTimer(); return read(); },
    invalidate(sourceId) {
      if (disposed) return;
      cancelRun();
      for (const descriptor of sources) if (sourceId === undefined || descriptor.source.id === sourceId) {
        const record = records.get(descriptor.key); record.good.clear(); record.entries = [];
      }
      publish(false);
    },
    dispose() { if (disposed) return; disposed = true; stopTimer(); cancelRun(); listeners.clear(); for (const record of records.values()) record.good.clear(); },
    state: () => ({ disposed, paused, cycles, requests, timeouts: deadlineFailures, activeRequests: run?.controllers.size ?? 0, subscribers: listeners.size, timerActive: timer !== null }),
  };
}
