/**
 * Source registry and polling store of dsh-route-balance. Pure: every host
 * dependency (Remote, fetch, timers, clock, logging) is injected, so the unit
 * tests drive it without a browser or a host.
 *
 * Two kinds of source feed the same snapshot:
 *
 *  1. **Remote sources** run inside the browser and read a namespace the host
 *     already exposes — the DeepSeek account route goes through the account
 *     Remote, so a credential never passes through this plugin:
 *
 *        { id: 'account', async read({ remote, metadata }) → entry }        // one entry
 *
 *  2. **Host sources** fetch a JSON route registered by the plugin's host half,
 *     which is where API-key routes are read (the browser must never see a key):
 *
 *        { id: 'host-route', async read({ fetchImpl, url }) → entry[] }
 *
 * An entry is always:
 *   { id, label, kind: 'ready'|'failed'|'unavailable', amounts?, detail?, at }
 * `amounts` is `[{ currency, text }]` — already formatted text, so the widget
 * never has to know how a provider spells its balance.
 */
import { describeError, entryAmounts, unavailableEntry } from "./core.js";

/** @returns the validated refresh interval in milliseconds. */
export function resolveRefreshMs(value, fallback) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 60000 ? Math.floor(ms) : fallback;
}

/** @returns the URL one host source fetches, or null when it has no route. */
export function hostUrl(base, path) {
  const root = typeof base === "string" && base !== "" ? base : "";
  const route = typeof path === "string" && path.startsWith("/") ? path : "/api/dsh-route-balance/balances";
  return root.replace(/\/$/, "") + route;
}

/**
 * Map one host route payload into entries.
 * Accepts this plugin's own contract; anything else is reported as a failure
 * rather than silently ignored.
 */
export function entriesFromHostPayload(payload) {
  if (payload === null || typeof payload !== "object") {
    return [{ id: "host", label: "DSH 主机", kind: "failed", detail: "主机返回了非 JSON 内容", at: Date.now() }];
  }
  if (payload.ok === false) {
    return [{ id: "host", label: "DSH 主机", kind: "failed", detail: String(payload.error ?? "主机报告失败"), at: Date.now() }];
  }
  if (!Array.isArray(payload.entries)) {
    return [{ id: "host", label: "DSH 主机", kind: "failed", detail: "主机响应缺少 entries", at: Date.now() }];
  }
  if (payload.ok !== true || payload.version !== 1) {
    return [{ id: "host", label: "DSH 主机", kind: "failed", amounts: [], detail: "主机响应版本或状态无效", at: Date.now() }];
  }
  return payload.entries
    .filter((entry) => entry !== null && typeof entry === "object" && typeof entry.id === "string")
    .map((entry) => {
      let kind = ["ready", "unavailable", "loading", "failed"].includes(entry.kind) ? entry.kind : "failed";
      const amounts = Array.isArray(entry.amounts)
        ? entry.amounts.filter((amount) => amount !== null && typeof amount === "object" && typeof amount.currency === "string" && typeof amount.text === "string" && amount.text.trim() !== "")
        : [];
      const summary = typeof entry.summary === "string" && entry.summary.trim() ? entry.summary : undefined;
      if (kind === "ready" && amounts.length === 0 && !summary) kind = "failed";
      const mapped = {
        id: entry.id,
        label: typeof entry.label === "string" && entry.label !== "" ? entry.label : entry.id,
        kind,
        amounts,
        at: Date.now(),
      };
      if (summary) mapped.summary = summary;
      if (typeof entry.short === "string" && entry.short.trim()) mapped.short = entry.short.slice(0, 16);
      if (entry.stale === true) mapped.stale = true;
      if (typeof entry.detail === "string" && entry.detail !== "") mapped.detail = entry.detail;
      if (kind === "failed" && entry.kind === "ready") mapped.detail = "主机没有返回有效余额或额度";
      if (typeof entry.topUpUrl === "string" && entry.topUpUrl !== "") mapped.topUpUrl = entry.topUpUrl;
      if (typeof entry.ms === "number") mapped.ms = entry.ms;
      return mapped;
    });
}

/**
 * Merge entries from several sources. A route read directly by the browser (the
 * account Remote) wins over the same route read through the host, and an
 * unavailable direct reading never hides a host reading that succeeded.
 */
export function mergeEntries(groups) {
  const byId = new Map();
  const order = [];
  for (const group of groups) {
    for (const entry of group ?? []) {
      if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
      const existing = byId.get(entry.id);
      if (existing === undefined) {
        byId.set(entry.id, entry);
        order.push(entry.id);
        continue;
      }
      if (existing.kind !== "ready" && entry.kind === "ready") byId.set(entry.id, entry);
    }
  }
  return order.map((id) => byId.get(id));
}

/** @returns entry text for one merged entry, tolerating both shapes. */
export function entryLabel(entry) {
  const amounts = Array.isArray(entry.amounts) && entry.amounts.length > 0
    ? entry.amounts.map((amount) => amount.text).join(" + ")
    : entryAmounts(entry).map((amount) => amount.text).join(" + ");
  if (entry.kind === "ready") {
    if (typeof entry.short === "string" && entry.short.trim()) return entry.short;
    if (typeof entry.summary === "string" && entry.summary.trim()) return entry.summary;
    return amounts === "" ? "无余额" : amounts;
  }
  if (entry.kind === "unavailable") return "不可用";
  if (entry.kind === "loading") return "读取中…";
  return "读取失败";
}

/**
 * Fold merged entries into one snapshot.
 * `kind` describes the whole surface: ready when any entry carries a balance,
 * unavailable when every source is unusable here, failed otherwise.
 */
export function foldSnapshot(entries, at, loading) {
  const list = Array.isArray(entries) ? entries.filter((entry) => entry !== null && typeof entry === "object") : [];
  const usable = list.filter((entry) => entry.kind === "ready" || entry.kind === "failed");
  const kind = list.some((entry) => entry.kind === "ready") ? "ready" : usable.length === 0 ? "unavailable" : "failed";
  return { kind, at, entries: list, loading: loading === true || list.some((entry) => entry.kind === "loading") };
}

/** @returns the compact figure shown in the sidebar. */
export function headlineText(snapshot) {
  const parts = [];
  for (const entry of snapshot?.entries ?? []) {
    if (entry.kind !== "ready") continue;
    const text = entryLabel(entry);
    if (text !== "无余额") parts.push(text);
    else if (parts.length === 0) parts.push(text);
  }
  if (parts.length > 0) return parts.join(" · ");
  if (snapshot?.loading) return "读取中…";
  if (snapshot?.kind === "unavailable") return "余额不可用";
  if (snapshot?.kind === "failed") return "读取失败";
  return "无余额";
}

/** @returns the tooltip lines: one per route, then the refresh hint. */
export function detailLines(snapshot, options = {}) {
  const lines = [];
  for (const entry of snapshot?.entries ?? []) {
    const label = entry.label ?? entry.id;
    if (entry.kind === "loading") {
      lines.push(label + "：读取中…");
      continue;
    }
    if (entry.kind === "ready") {
      lines.push(label + "：" + entryLabel(entry));
      for (const wallet of entry.bonusWallets ?? []) {
        const amount = Number(wallet?.balance);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        lines.push("  赠送 " + (wallet.currency ?? "") + " " + wallet.balance);
      }
      if (entry.detail) lines.push("  " + entry.detail);
      continue;
    }
    const reason = entry.detail ?? (entry.kind === "unavailable" ? "此环境不可用" : "读取失败");
    lines.push(label + "：" + reason);
  }
  if (lines.length === 0) lines.push(options.itemLabel ?? "没有可用的余额来源");
  lines.push(options.hint ?? "点击刷新");
  return lines;
}

/**
 * Create the polling store.
 * @param deps - `{ id?, remoteSources?, hostSources?, remote?, metadata, fetchImpl,
 *                  hostBase?, refreshMs, fallbackRefreshMs?, timers?, now?, log? }`.
 */
export function createStore(deps) {
  const remoteSources = (deps.remoteSources ?? []).filter((source) => source !== null && typeof source === "object" && typeof source.read === "function");
  // A host source either fetches the plugin's own route (id + path) or brings
  // its own reader; a source without either could never produce an entry.
  const hostSources = (deps.hostSources ?? []).filter(
    (source) => source !== null && typeof source === "object" && (typeof source.read === "function" || typeof source.path === "string" || typeof source.url === "string"),
  );
  const fallbackMs = Number.isFinite(deps.fallbackRefreshMs) ? deps.fallbackRefreshMs : deps.refreshMs;
  const refreshMs = resolveRefreshMs(deps.refreshMs, fallbackMs);
  const timers = deps.timers ?? { setInterval, clearInterval };
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const fetchImpl = deps.fetchImpl ?? fetch;
  const id = typeof deps.id === "string" && deps.id !== "" ? deps.id : "route-balance";

  let snapshot = foldSnapshot([], 0, true);
  const listeners = new Set();
  let timer = null;
  let inFlight = null;
  let disposed = false;
  const unavailable = new Set();

  const publish = (entries) => {
    snapshot = foldSnapshot(entries, now(), false);
    for (const listener of listeners) listener();
  };

  /** Read one Remote source; returns the entries it produced. */
  const readRemote = async (source) => {
    const result = await source.read({
      remote: deps.remote,
      metadata: deps.metadata(),
      fetchImpl,
      log,
    });
    const list = Array.isArray(result) ? result : [result];
    return list.map((entry) => {
      if (entry !== null && typeof entry === "object" && typeof entry.id === "string") return { at: now(), ...entry };
      return unavailableEntry(source.id ?? "remote", source.label ?? source.id ?? "remote", "适配器没有返回条目", now());
    });
  };

  /** Read one host source; returns the entries it produced. */
  const readHost = async (source) => {
    const url = source.url ?? hostUrl(deps.hostBase, source.path);
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) {
      return [{ id: source.id ?? "host", label: source.label ?? "DSH 主机", kind: "failed", detail: response.status === 401 || response.status === 403 ? "DSH 会话已失效，请刷新页面" : `HTTP ${response.status}`, at: now() }];
    }
    return entriesFromHostPayload(await response.json());
  };

  const readOnce = async (source, kind) => {
    try {
      return kind === "host" ? await readHost(source) : await readRemote(source);
    } catch (error) {
      const why = describeError(error);
      log(`[${id}] source "${source.id ?? kind}" failed`, why);
      return [{ id: source.id ?? kind, label: source.label ?? (kind === "host" ? "DSH 主机" : source.id ?? kind), kind: "failed", detail: why, at: now() }];
    }
  };

  const read = async () => {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      const hosts = hostSources.filter((source) => !unavailable.has(source.id ?? "host"));
      const groups = await Promise.all([
        ...remoteSources.filter((source) => !unavailable.has(source.id ?? "remote")).map((source) => readOnce(source, "remote")),
        ...hosts.map((source) => readOnce(source, "host")),
      ]);
      if (!disposed) publish(mergeEntries(groups));
      inFlight = null;
      return snapshot;
    })();
    return inFlight;
  };

  return {
    id,
    refreshMs,
    sourceIds: [...remoteSources, ...hostSources].map((source) => source.id ?? "source"),
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (timer === null && !disposed) {
        timer = timers.setInterval(() => {
          void read();
        }, refreshMs);
        if (typeof timer === "object" && timer !== null && typeof timer.unref === "function") timer.unref();
      }
      void read();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          timers.clearInterval(timer);
          timer = null;
        }
      };
    },
    refresh: () => read(),
    dispose() {
      disposed = true;
      if (timer !== null) {
        timers.clearInterval(timer);
        timer = null;
      }
      listeners.clear();
    },
  };
}
