/** Self-contained browser template; regenerate lib/client.js with tools/build-client.mjs. */
window.__ModuleLoader__.load({
  id: "dsh-route-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");

    /** Display symbols for the currency codes the providers use. */
    const SYMBOLS = { CNY: "¥", USD: "$", HKD: "HK$", EUR: "€", JPY: "¥" };

    /** @returns the display symbol for one currency code. */
    function currencySymbol(currency) {
      return SYMBOLS[currency] ?? (currency ? currency + " " : "");
    }

    /** Round one non-negative decimal string to `digits` places, half-up, on integers only. */
    function roundDecimalString(text, digits) {
      if (typeof text !== 'string' && typeof text !== 'number') return null;
      const raw = String(text ?? "").trim();
      if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
      const [whole, fraction = ""] = raw.split(".");
      const keep = fraction.slice(0, digits);
      const next = fraction.slice(digits, digits + 1);
      let value = BigInt(whole + keep.padEnd(digits, "0"));
      if (next !== "" && Number(next) >= 5) value += 1n;
      const text2 = value.toString().padStart(digits + 1, "0");
      return digits === 0 ? text2 : text2.slice(0, -digits) + "." + text2.slice(-digits);
    }

    /** Group the integer part with separators; leaves the fraction untouched. */
    function groupDigits(text) {
      const [whole, fraction] = String(text).split(".");
      const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return fraction === undefined ? grouped : grouped + "." + fraction;
    }

    /**
     * Format one provider balance string: two decimals normally, four for sub-cent
     * remainders, and the raw string when it is not a plain decimal (the DeepSeek
     * Platform may answer `5.0000000000000000`).
     */
    function formatAmount(text) {
      const value = roundDecimalString(text, 2);
      if (value === null) return String(text ?? "");
      const amount = asNumber(text);
      if (value === "0.00" && amount !== null && amount > 0) {
        const precise = roundDecimalString(text, 4);
        return precise === null ? String(text) : groupDigits(precise);
      }
      return groupDigits(value);
    }

    /** @returns a plain-decimal amount, or null when the string is not one. */
    function asNumber(text) {
      if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
      if (typeof text !== "string") return null;
      const raw = text.trim();
      // The account API can spell a measured zero as 0E-16; this is not unknown.
      if (/^0+(?:\.0+)?[Ee][+-]?\d+$/.test(raw)) return 0;
      if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }

    /** @returns whether the string is a usable non-negative balance amount. */
    function isAmount(text) {
      return asNumber(text) !== null;
    }

    /**
     * Strict "this really is a number" test for values that arrive as JSON.
     *
     * `Number(value)` is not enough: it turns `null` into a confident 0, `""` into 0,
     * `true` into 1 and `false` into 0 — which is how a missing field became a
     * trustworthy balance. Booleans, null, undefined, empty strings, arrays and
     * objects are all rejected here; only a finite number or a plain decimal string
     * passes. Whitespace around a decimal string is tolerated because providers pad.
     *
     * @returns `true` when `value` is a finite number or a plain decimal string.
     */
    function isNumeric(value) {
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value !== 'string') return false;
      const raw = value.trim();
      if (raw === '' || !/^-?\d+(?:\.\d+)?$/.test(raw)) return false;
      return Number.isFinite(Number(raw));
    }

    /** @returns one wallet list with unusable members dropped. */
    function walletsOf(value) {
      if (!Array.isArray(value)) return [];
      return value.filter((wallet) => wallet !== null && typeof wallet === "object" && typeof wallet.currency === "string" && /^[A-Z]{3,8}$/.test(wallet.currency) && wallet.balance !== undefined);
    }

    /**
     * Sum wallet amounts that share a currency.
     * @returns [{currency, balance}] in first-seen currency order.
     */
    function totalsByCurrency(wallets) {
      const totals = new Map();
      for (const wallet of walletsOf(wallets)) {
        const amount = asNumber(wallet.balance);
        if (amount === null) continue;
        const currency = wallet.currency;
        totals.set(currency, (totals.get(currency) ?? 0) + amount);
      }
      return [...totals].filter(([, total]) => Number.isFinite(total)).map(([currency, total]) => ({ currency, balance: total.toFixed(8) }));
    }

    /** @returns the currency whose total is the headline figure, or null. */
    function headline(wallets) {
      const totals = totalsByCurrency(wallets);
      if (totals.length === 0) return null;
      let best = totals[0];
      for (const entry of totals) if (Number(entry.balance) > Number(best.balance)) best = entry;
      return best;
    }

    /** @returns the formatted amounts of one entry's wallets, if it carries any. */
    function entryAmounts(entry) {
      return totalsByCurrency(entry?.wallets).map((total) => ({
        currency: total.currency,
        text: currencySymbol(total.currency) + formatAmount(total.balance),
      }));
    }

    /** @returns an unavailable entry for a source that cannot answer right now. */
    function unavailableEntry(id, label, reason, at) {
      return {
        id: String(id ?? "unknown"),
        label: String(label ?? id ?? "unknown"),
        at,
        kind: "unavailable",
        detail: typeof reason === "string" ? reason : undefined,
      };
    }

    /** Never display arbitrary Remote or thrown-error messages in the page. */
    function describeError(error) {
      const known = ["gateway/cancelled", "gateway/unauthorized", "gateway/forbidden", "gateway/timeout", "gateway/unavailable"];
      if (known.includes(error?.code)) return error.code;
      if (error?.name === "TimeoutError") return "读取超时，请稍后重试";
      if (error?.name === "AbortError") return "读取已取消";
      return "读取失败，请检查连接和账号状态";
    }

    /**
     * The calling-UI identity every DeepSeek Platform-reaching account call needs.
     * @param version - this plugin's version.
     * @param navigatorLike - `navigator` (or a stand-in with `language`).
     * @param now - current date.
     */
    function clientMetadata(version, navigatorLike, now) {
      const language = typeof navigatorLike?.language === "string" ? navigatorLike.language : "zh-CN";
      const date = now ?? new Date();
      return {
        version,
        locale: language,
        timezoneOffsetSeconds: -date.getTimezoneOffset() * 60,
      };
    }
    const DEFAULT_MAX_STALE_MS = 86400000;
    const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

    function resolveRefreshMs(value, fallback = 300000) {
      const ms = Number(value);
      return Number.isFinite(ms) && ms >= 60000 ? Math.min(Math.floor(ms), 86400000) : fallback;
    }
    function hostUrl(base, path) {
      const root = typeof base === "string" && base !== "" ? base : "";
      const route = typeof path === "string" && path.startsWith("/") ? path : "/api/dsh-route-balance/balances";
      return root.replace(/\/$/, "") + route;
    }
    const bounded = (value, fallback) => typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : fallback;
    const stamp = (entry, now) => {
      const value = entry?.lastSuccessAt ?? entry?.at;
      return typeof value === "number" && Number.isFinite(value) ? Math.min(value, now) : now;
    };
    function hasReading(entry) {
      if (!entry || entry.kind !== "ready") return false;
      return (Array.isArray(entry.amounts) && entry.amounts.some(a => a && typeof a.text === "string" && a.text.trim())) ||
        (typeof entry.summary === "string" && entry.summary.trim() !== "") || entryAmounts(entry).length > 0;
    }

    /** Retain only an explicitly labelled, time-bounded reading of the same identity. */
    function retainReading(previous, current, now = Date.now(), maxStaleMs = DEFAULT_MAX_STALE_MS) {
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
    function entriesFromHostPayload(payload, at = Date.now()) {
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
    function mergeEntries(groups) {
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
    function entryLabel(entry) {
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
    function foldSnapshot(entries, at, loading) {
      const list = Array.isArray(entries) ? entries.filter(e => e && typeof e === "object") : [];
      const usable = list.filter(e => e.kind === "ready" || e.kind === "failed");
      return { kind: list.some(e => e.kind === "ready") ? "ready" : usable.length === 0 ? "unavailable" : "failed",
        at, entries: list, loading: loading === true || list.some(e => e.kind === "loading") };
    }
    function headlineText(snapshot) {
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
    function detailLines(snapshot, options = {}) {
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
    function balanceTooltip(snapshot) {
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
    function createStore(deps = {}) {
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

    const STYLE_ID = "dsh-route-balance/balance.css";
    const css = [
      ".dshrb-root{display:flex;min-width:0;max-width:100%}",
      ".dshrb-button{display:flex;align-items:center;gap:5px;min-height:32px;max-width:100%;padding:4px 10px;",
      "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15));border-radius:8px;",
      "background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-secondary,currentColor);",
      "font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;",
      "transition:border-color .15s,background .15s}",
      ".dshrb-button::before{content:'💰 余额';font-size:11px;font-weight:500;",
      "color:var(--dsw-alias-label-tertiary,#9aa0a6);letter-spacing:.02em;flex:none}",
      ".dshrb-button:hover,.dshrb-button:focus-visible{background:var(--dsw-alias-fill-l1,rgba(127,127,127,.12));",
      "border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.25));color:var(--dsw-alias-label-primary,currentColor)}",
      ".dshrb-button:disabled{cursor:default;opacity:.6}",
      ".dshrb-button[data-state=failed]{color:var(--dsw-alias-state-error-primary,#d4380d)}",
      ".dshrb-dot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-tertiary,#9aa0a6)}",
      ".dshrb-button[data-state=ready] .dshrb-dot{background:var(--dsw-alias-state-success-primary,#52c41a)}",
      ".dshrb-button[data-stale=true] .dshrb-dot{background:var(--dsw-alias-state-warning-primary,#b88319)}",
      ".dshrb-button[data-state=failed] .dshrb-dot{background:var(--dsw-alias-state-error-primary,#d4380d)}",
      ".dshrb-value{overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;font-weight:500;",
      "color:var(--dsw-alias-label-primary,currentColor)}",
    ].join("");
    if (typeof document !== "undefined") {
      let tag = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]');
      if (!tag) {
        tag = document.createElement("style");
        tag.dataset.plugin = "dsh-route-balance"; tag.dataset.pluginCss = STYLE_ID;
        document.head.appendChild(tag);
      }
      tag.textContent = css;
    }

    const PLUGIN_ID = "dsh-route-balance";
    const VERSION = "0.6.4";
    const DEFAULT_SLOT = "sidebar.footer.action";
    const DEFAULT_REFRESH_MS = 300000;
    const HOST_ROUTE = "/api/dsh-route-balance/balances";
    function metadata() {
      return clientMetadata(VERSION, typeof navigator === "undefined" ? undefined : navigator, new Date());
    }
    const accountFailure = error => ({ id: "deepseek-account", label: "DeepSeek 账号", kind: "failed", configured: true,
      detail: describeError(error), ...(["gateway/unauthorized", "gateway/forbidden"].includes(error?.code) ?
        { retryable: false, cachePolicy: "reset" } : {}) });
    const accountEpoch = "activation:" + Math.random().toString(36).slice(2);
    const accountSource = {
      id: "deepseek-account", label: "DeepSeek 账号",
      async read({ remote, signal }) {
        if (typeof remote?.account?.getState !== "function") return { id: this.id, label: this.label,
          kind: "unavailable", configured: false, retryable: false, cachePolicy: "reset", detail: "此配置未提供账号服务" };
        const state = await remote.account.getState();
        if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
        if (!state?.ok) return accountFailure(state?.error);
        if (state.value?.status !== "credential-stored") return { id: this.id, label: this.label,
          kind: "unavailable", configured: false, retryable: false, cachePolicy: "reset", detail: "未登录（设置 → 账号）" };
        const basis = { id: this.id, label: this.label, configured: true,
          generation: typeof state.value.attempt?.id === "string" ? "login:" + state.value.attempt.id : accountEpoch };
        const balance = await remote.account.getBalance(metadata());
        if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
        if (!balance?.ok) return { ...accountFailure(balance?.error), ...basis };
        // The official controller uses null when the account grant is absent or changed.
        if (balance.value === null || balance.value === undefined) return { ...basis, kind: "unavailable",
          configured: false, retryable: false, cachePolicy: "reset", detail: "账号已退出或切换" };
        if (balance.value?.status !== "ready") return { ...basis, kind: "failed", detail: "平台没有返回余额" };
        const amounts = totalsByCurrency(balance.value.value).map(total => ({
          currency: total.currency, text: currencySymbol(total.currency) + formatAmount(total.balance),
        }));
        if (!amounts.length) return { ...basis, kind: "failed", detail: "平台没有返回有效余额" };
        return { ...basis, kind: "ready", amounts,
          bonusWallets: balance.value.bonusWallets,
          topUpUrl: typeof state.value.links?.topUpUrl === "string" ? state.value.links.topUpUrl : undefined };
      },
    };
    const hostSource = { id: "host-routes", label: "DSH 主机", path: HOST_ROUTE };
    const remoteSources = [accountSource], hostSources = [hostSource];

    const brokenSnapshot = () => ({ kind: "failed", loading: false, entries: [], at: Date.now() });
    function readSnapshot(store) {
      try { return typeof store?.getSnapshot === "function" ? store.getSnapshot() : brokenSnapshot(); }
      catch { return brokenSnapshot(); }
    }
    function useSnapshot(store) {
      const [value, setValue] = react.useState(() => readSnapshot(store));
      react.useEffect(() => {
        try {
          if (typeof store?.subscribe !== "function") return undefined;
          return store.subscribe(() => setValue(readSnapshot(store)));
        } catch {
          setValue(brokenSnapshot());
          return undefined;
        }
      }, [store]);
      return value;
    }
    function RouteBalance(props) {
      const store = props.store, snapshot = useSnapshot(store);
      let text, tooltip;
      try {
        if (snapshot?.entries?.some(e => !e || typeof e !== "object")) throw new Error("invalid entries");
        text = headlineText(snapshot); tooltip = balanceTooltip(snapshot);
      } catch {
        text = "余额显示出错"; tooltip = "余额显示异常";
      }
      const onActivate = react.useCallback(() => {
        try { const work = store?.refresh?.(); work?.catch?.(() => {}); } catch { /* The visible state remains. */ }
      }, [store]);
      const kind = snapshot?.kind ?? "failed";
      const state = snapshot?.loading && kind !== "ready" ? "loading" : kind;
      return react_jsx_runtime.jsx("div", { className: "dshrb-root", children: react_jsx_runtime.jsx("button", {
        type: "button", className: "dshrb-button", "data-state": state,
        "data-stale": snapshot?.entries?.some(e => e?.stale === true) === true ? "true" : "false",
        title: tooltip, "aria-label": "余额 " + text, onClick: onActivate,
        disabled: state === "loading" && snapshot?.refreshing === true,
        children: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
          react_jsx_runtime.jsx("span", { className: "dshrb-dot", "aria-hidden": "true" }),
          react_jsx_runtime.jsx("span", { className: "dshrb-value", children: text }),
        ] }),
      }) });
    }

    const inject = ["slots"];
    function remoteService(ctx) {
      try { if (typeof ctx?.get === "function") return ctx.get("remote"); } catch { /* Optional service. */ }
      return ctx?.remote;
    }
    function remoteFacade(ctx) { return { get account() { return remoteService(ctx)?.account; } }; }
    function brokenStore() { const snapshot = brokenSnapshot(); return {
      getSnapshot: () => snapshot, subscribe: () => () => {}, refresh: async () => snapshot, dispose: () => {},
    }; }
    function apply(ctx, config) {
      if (!ctx?.slots) throw new Error(PLUGIN_ID + ": the slot registry service is missing");
      const settings = config ?? {}, slot = typeof settings.slot === "string" && settings.slot ? settings.slot : DEFAULT_SLOT;
      let store;
      try {
        store = createStore({ id: PLUGIN_ID, remoteSources, hostSources, remote: remoteFacade(ctx), metadata,
          fetchImpl: (...args) => globalThis.fetch(...args), refreshMs: settings.refreshMs,
          requestTimeoutMs: Math.max(DEFAULT_REQUEST_TIMEOUT_MS, (Number(settings.requestTimeoutMs) || 15000) + 1000), maxStaleMs: settings.maxStaleMs,
          fallbackRefreshMs: DEFAULT_REFRESH_MS,
          // Browser native APIs must retain their global receiver (Illegal invocation regression).
          timers: { setInterval: (...args) => globalThis.setInterval(...args), clearInterval: (...args) => globalThis.clearInterval(...args) },
          log: (...args) => globalThis.console.info(...args),
        });
        ctx.effect(() => () => store.dispose(), "route-balance: polling store lifetime");
        // Sleeping/offline pages do no network work. A visible/online page catches up immediately.
        const available = () => (typeof document === "undefined" || document.hidden !== true) &&
          (typeof navigator === "undefined" || navigator.onLine !== false);
        const sync = () => { if (available()) void store.resume().catch(() => {}); else store.pause(); };
        if (!available()) store.pause();
        ctx.effect(() => {
          document?.addEventListener?.("visibilitychange", sync);
          for (const event of ["online", "offline", "focus"]) globalThis.addEventListener?.(event, sync);
          return () => {
            document?.removeEventListener?.("visibilitychange", sync);
            for (const event of ["online", "offline", "focus"]) globalThis.removeEventListener?.(event, sync);
          };
        }, "route-balance: page lifecycle listeners");
        // Account readings belong to this connection; never replay them after a reset/sign-in change.
        ctx.on?.("connection/reset", () => { store.invalidate("deepseek-account"); if (available()) void store.refresh().catch(() => {}); });
      } catch { store = brokenStore(); }
      ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id: "route-balance", order: 30,
        inject: () => ({ store }) }, RouteBalance));
    }
    exports.apply = apply; exports.inject = inject; exports.RouteBalance = RouteBalance;
    exports.createStore = createStore; exports.remoteSources = remoteSources; exports.hostSources = hostSources;
    exports.accountSource = accountSource; exports.balanceTooltip = balanceTooltip;
    exports.defaults = { refreshMs: DEFAULT_REFRESH_MS, slot: DEFAULT_SLOT, hostRoute: HOST_ROUTE, version: VERSION };
    return module.exports;
  },
});
