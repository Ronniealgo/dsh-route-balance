/** Self-contained browser template; regenerate lib/client.js with tools/build-client.mjs. */
window.__ModuleLoader__.load({
  id: "__ID__",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");

    __CORE__
    __REGISTRY__

    const STYLE_ID = "__ID__/balance.css";
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
        tag.dataset.plugin = "__ID__"; tag.dataset.pluginCss = STYLE_ID;
        document.head.appendChild(tag);
      }
      tag.textContent = css;
    }

    const PLUGIN_ID = "__ID__";
    const VERSION = "__VERSION__";
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
