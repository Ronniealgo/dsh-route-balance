/**
 * dsh-route-balance — browser-half source.
 *
 * Run `node tools/build-client.mjs` after editing. The build replaces:
 *   `__CORE__`      → the body of `lib/core.js`     (formatting + entry model)
 *   `__REGISTRY__`  → the body of `lib/registry.js` (provider registry + store)
 *   `dsh-route-balance`        → the package name, which is also the browser module id
 *   `0.6.2`   → the package version
 *
 * Both modules are inlined because the browser module system resolves platform
 * modules and package roots only — never a package subpath — so the shipped
 * bundle has to be self-contained.
 *
 * Bundle form: the shipped `window.__ModuleLoader__.load({id, factory})`
 * contract that `@deepseek-ai/dsh-client-modules` consumes.
 */
window.__ModuleLoader__.load({
  id: "dsh-route-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");

    //#region core (generated from lib/core.js)
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
    //#endregion

    //#region registry (generated from lib/registry.js)
    /** @returns the validated refresh interval in milliseconds. */
    function resolveRefreshMs(value, fallback) {
      const ms = Number(value);
      return Number.isFinite(ms) && ms >= 60000 ? Math.floor(ms) : fallback;
    }

    /** @returns the URL one host source fetches, or null when it has no route. */
    function hostUrl(base, path) {
      const root = typeof base === "string" && base !== "" ? base : "";
      const route = typeof path === "string" && path.startsWith("/") ? path : "/api/dsh-route-balance/balances";
      return root.replace(/\/$/, "") + route;
    }

    /**
     * Map one host route payload into entries.
     * Accepts this plugin's own contract; anything else is reported as a failure
     * rather than silently ignored.
     */
    function entriesFromHostPayload(payload) {
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
    function mergeEntries(groups) {
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
    function entryLabel(entry) {
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
    function foldSnapshot(entries, at, loading) {
      const list = Array.isArray(entries) ? entries.filter((entry) => entry !== null && typeof entry === "object") : [];
      const usable = list.filter((entry) => entry.kind === "ready" || entry.kind === "failed");
      const kind = list.some((entry) => entry.kind === "ready") ? "ready" : usable.length === 0 ? "unavailable" : "failed";
      return { kind, at, entries: list, loading: loading === true || list.some((entry) => entry.kind === "loading") };
    }

    /** @returns the compact figure shown in the sidebar. */
    function headlineText(snapshot) {
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
    function detailLines(snapshot, options = {}) {
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
    function createStore(deps) {
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
    //#endregion

    //#region styles
    const STYLE_ID = "dsh-route-balance/balance.css";
    const css = [
      ".dshrb-root{display:flex;min-width:0;max-width:100%}",
      ".dshrb-button{display:flex;align-items:center;gap:6px;min-height:28px;max-width:100%;padding:3px 8px;",
      "border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);",
      "font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}",
      ".dshrb-button:hover,.dshrb-button:focus-visible{background:var(--dsw-alias-fill-l1,rgba(127,127,127,.12));",
      "color:var(--dsw-alias-label-primary,currentColor)}",
      ".dshrb-button:disabled{cursor:default;opacity:.6}",
      ".dshrb-button[data-state=failed]{color:var(--dsw-alias-state-error-primary,#d4380d)}",
      ".dshrb-dot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-tertiary,#9aa0a6)}",
      ".dshrb-value{overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}",
    ].join("");
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-route-balance";
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region built-in sources
    const PLUGIN_ID = "dsh-route-balance";
    const VERSION = "0.6.2";
    const DEFAULT_SLOT = "sidebar.footer.action";
    const DEFAULT_REFRESH_MS = 300000;
    const HOST_ROUTE = "/api/dsh-route-balance/balances";

    /** @returns the calling-UI identity the account Remote reports to DeepSeek. */
    function metadata() {
      return clientMetadata(VERSION, typeof navigator === "undefined" ? undefined : navigator, new Date());
    }

    /**
     * Remote source: the DeepSeek account route (`deepseek-account`).
     *
     * Reads through the account Remote the shipped account controller already
     * publishes — the same snapshot the Settings → Account page shows. No
     * credential, cookie or API key reaches this plugin, and the balance of a
     * signed-out route is reported as unavailable instead of 0. A profile
     * without an account Remote is reported the same way, so this source alone
     * accounts for the missing figure instead of failing the whole widget.
     */
    const accountSource = {
      id: "deepseek-account",
      label: "DeepSeek 账号",
      async read({ remote }) {
        if (typeof remote?.account?.getState !== "function") {
          return { id: "deepseek-account", label: "DeepSeek 账号", kind: "unavailable", detail: "此配置未提供账号服务" };
        }
        const state = await remote.account.getState();
        if (!state.ok) {
          return { id: "deepseek-account", label: "DeepSeek 账号", kind: "failed", detail: describeError(state.error) };
        }
        if (state.value.status !== "credential-stored") {
          return { id: "deepseek-account", label: "DeepSeek 账号", kind: "unavailable", detail: "未登录（设置 → 账号）" };
        }
        const balance = await remote.account.getBalance(metadata());
        if (!balance.ok) {
          return { id: "deepseek-account", label: "DeepSeek 账号", kind: "failed", detail: describeError(balance.error) };
        }
        if (balance.value === null || balance.value === undefined || balance.value.status !== "ready") {
          return { id: "deepseek-account", label: "DeepSeek 账号", kind: "unavailable", detail: "平台没有返回余额" };
        }
        const amounts = totalsByCurrency(balance.value.value).map((total) => ({
          currency: total.currency,
          text: currencySymbol(total.currency) + formatAmount(total.balance),
        }));
        if (amounts.length === 0) {
          return { id: "deepseek-account", label: "DeepSeek 账号", kind: "failed", detail: "平台没有返回有效余额" };
        }
        return {
          id: "deepseek-account",
          label: "DeepSeek 账号",
          kind: "ready",
          amounts,
          bonusWallets: balance.value.bonusWallets,
          topUpUrl: typeof state.value.links?.topUpUrl === "string" ? state.value.links.topUpUrl : undefined,
        };
      },
    };

    /**
     * Host source: every API-key route, read by the plugin's host half at
     * `HOST_ROUTE` (see lib/index.js). The key stays on the host; the browser
     * only ever receives formatted amounts.
     */
    const hostSource = {
      id: "host-routes",
      label: "DSH 主机",
      path: HOST_ROUTE,
    };

    /**
     * What this activation reads. To add a route: for a Remote-backed route
     * append to `remoteSources`, for a key-based route register an adapter in
     * the host half's `PROVIDERS` and it arrives through `hostSource`.
     */
    const remoteSources = [accountSource];
    const hostSources = [hostSource];
    //#endregion

    //#region component
    /** Subscribe one component to the store's external snapshot. */
    function useSnapshot(store) {
      const [value, setValue] = react.useState(() => store.getSnapshot());
      react.useEffect(() => store.subscribe(() => setValue(store.getSnapshot())), [store]);
      return value;
    }

    /**
     * The balance control: the live figure of every readable API route, hover
     * for the per-route breakdown, click to read again.
     */
    function RouteBalance(props) {
      const store = props.store;
      const snapshot = useSnapshot(store);
      const lines = detailLines(snapshot);
      const text = headlineText(snapshot);
      const onActivate = react.useCallback(() => store.refresh(), [store]);
      const state = snapshot.loading && snapshot.kind !== "ready" ? "loading" : snapshot.kind;
      return react_jsx_runtime.jsx("div", {
        className: "dshrb-root",
        children: react_jsx_runtime.jsx("button", {
          type: "button",
          className: "dshrb-button",
          "data-state": state,
          title: lines.join("\n"),
          "aria-label": "API 路由余额：" + text + "。" + lines.join("；"),
          onClick: onActivate,
          disabled: state === "loading",
          children: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
            children: [
              react_jsx_runtime.jsx("span", { className: "dshrb-dot", "aria-hidden": "true" }),
              react_jsx_runtime.jsx("span", { className: "dshrb-value", children: text }),
            ],
          }),
        }),
      });
    }
    //#endregion

    //#region plugin body
    /** Client services this plugin needs: the slot registry and the Remote namespace (the account namespace is optional). */
    const inject = ["slots", "remote"];

    /**
     * Register the balance control into the configured slot (sidebar foot by
     * default) and own the polling store for this plugin activation.
     * @param ctx - client plugin context carrying `slots` and `remote`.
     * @param config - this Loader row's config: `{ slot?, refreshMs? }`.
     */
    function apply(ctx, config) {
      // Fail with a plugin-name-bearing message instead of a bare
      // "cannot read properties of undefined", which is what a bundle whose
      // `dsh.client.inject` drifted from its `inject` export looks like in the
      // shell's startup audit.
      if (ctx?.slots === undefined || ctx?.remote === undefined) {
        throw new Error(PLUGIN_ID + ": client plugin services are missing — check `dsh.client.inject` in package.json against the `inject` export in this bundle");
      }
      const settings = config ?? {};
      const slot = typeof settings.slot === "string" && settings.slot !== "" ? settings.slot : DEFAULT_SLOT;
      const store = createStore({
        id: PLUGIN_ID,
        remoteSources,
        hostSources,
        remote: ctx.remote,
        metadata,
        fetchImpl: (...args) => fetch(...args),
        refreshMs: settings.refreshMs,
        fallbackRefreshMs: DEFAULT_REFRESH_MS,
        timers: { setInterval, clearInterval },
        log: (...args) => console.info(...args),
      });
      ctx.effect(() => () => store.dispose(), "route-balance: polling store lifetime");
      ctx.slots.inject(slot, () => ctx.slots.register({
        name: slot,
        id: "route-balance",
        order: 30,
        inject: () => ({ store }),
      }, RouteBalance));
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    exports.RouteBalance = RouteBalance;
    exports.createStore = createStore;
    exports.remoteSources = remoteSources;
    exports.hostSources = hostSources;
    exports.accountSource = accountSource;
    exports.defaults = { refreshMs: DEFAULT_REFRESH_MS, slot: DEFAULT_SLOT, hostRoute: HOST_ROUTE, version: VERSION };
    return module.exports;
  },
});
