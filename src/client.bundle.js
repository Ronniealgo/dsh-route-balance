/**
 * dsh-route-balance — browser-half source.
 *
 * Run `node tools/build-client.mjs` after editing. The build replaces:
 *   `__CORE__`      → the body of `lib/core.js`     (formatting + entry model)
 *   `__REGISTRY__`  → the body of `lib/registry.js` (provider registry + store)
 *   `__ID__`        → the package name, which is also the browser module id
 *   `__VERSION__`   → the package version
 *
 * Both modules are inlined because the browser module system resolves platform
 * modules and package roots only — never a package subpath — so the shipped
 * bundle has to be self-contained.
 *
 * Bundle form: the shipped `window.__ModuleLoader__.load({id, factory})`
 * contract that `@deepseek-ai/dsh-client-modules` consumes.
 */
window.__ModuleLoader__.load({
  id: "__ID__",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");

    //#region core (generated from lib/core.js)
    __CORE__
    //#endregion

    //#region registry (generated from lib/registry.js)
    __REGISTRY__
    //#endregion

    //#region styles
    const STYLE_ID = "__ID__/balance.css";
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
      tag.dataset.plugin = "__ID__";
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region built-in sources
    const PLUGIN_ID = "__ID__";
    const VERSION = "__VERSION__";
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
