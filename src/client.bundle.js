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
      ".dshrb-button{display:flex;align-items:center;gap:5px;min-height:32px;max-width:100%;padding:4px 10px;",
      "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15));border-radius:8px;",
      "background:var(--dsw-alias-bg-layer-2,transparent);",
      "color:var(--dsw-alias-label-secondary,currentColor);",
      "font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;",
      "transition:border-color .15s,background .15s}",
      ".dshrb-button::before{content:'💰 余额';font-size:11px;font-weight:500;",
      "color:var(--dsw-alias-label-tertiary,#9aa0a6);letter-spacing:.02em;flex:none}",
      ".dshrb-button:hover,.dshrb-button:focus-visible{background:var(--dsw-alias-fill-l1,rgba(127,127,127,.12));",
      "border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.25));",
      "color:var(--dsw-alias-label-primary,currentColor)}",
      ".dshrb-button:disabled{cursor:default;opacity:.6}",
      ".dshrb-button[data-state=failed]{color:var(--dsw-alias-state-error-primary,#d4380d);",
      "border-color:var(--dsw-alias-state-error-primary,#d4380d)}",
      ".dshrb-button[data-state=loading]{opacity:.7}",
      ".dshrb-dot{flex:none;width:6px;height:6px;border-radius:999px;",
      "background:var(--dsw-alias-label-tertiary,#9aa0a6)}",
      ".dshrb-button[data-state=ready] .dshrb-dot{background:var(--dsw-alias-state-success-primary,#52c41a)}",
      ".dshrb-button[data-state=failed] .dshrb-dot{background:var(--dsw-alias-state-error-primary,#d4380d)}",
      ".dshrb-value{overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;",
      "font-weight:500;color:var(--dsw-alias-label-primary,currentColor)}",
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
    /** Read a store snapshot, tolerating a store that is missing or throwing. */
    function readSnapshot(store) {
      try {
        return typeof store?.getSnapshot === "function" ? store.getSnapshot() : undefined;
      } catch {
        return undefined;
      }
    }

    /** Subscribe one component to the store's external snapshot. */
    function useSnapshot(store) {
      const [value, setValue] = react.useState(() => readSnapshot(store));
      react.useEffect(() => {
        try {
          if (typeof store?.subscribe !== "function") return undefined;
          return store.subscribe(() => setValue(readSnapshot(store)));
        } catch {
          // A subscribe that throws (e.g. browser "Illegal invocation") must
          // not blank the slot entry; the component still renders its first
          // snapshot and the user sees a readable line.
          return undefined;
        }
      }, [store]);
      return value;
    }

    /**
     * The balance control: the live figure of every readable API route, hover
     * for the per-route breakdown, click to read again.
     *
     * The shell replaces a slot entry whose component throws with an empty
     * placeholder and only logs the error on the browser console, so every
     * derived value is computed defensively: a broken reading must show one
     * readable line here instead of making the whole control disappear.
     */
    function RouteBalance(props) {
      const store = props.store;
      const snapshot = useSnapshot(store);
      let lines;
      let text;
      try {
        lines = detailLines(snapshot);
        text = headlineText(snapshot);
      } catch (error) {
        text = "余额显示出错";
        lines = [String(error?.message ?? error)];
      }
      const onActivate = react.useCallback(() => {
        try {
          const result = store?.refresh?.();
          if (result && typeof result.catch === "function") result.catch(() => {});
        } catch {
          // A refresh failure is reported by the store's own snapshot.
        }
      }, [store]);
      const kind = snapshot?.kind ?? "failed";
      const state = snapshot?.loading && kind !== "ready" ? "loading" : kind;
      return react_jsx_runtime.jsx("div", {
        className: "dshrb-root",
        children: react_jsx_runtime.jsx("button", {
          type: "button",
          className: "dshrb-button",
          "data-state": state,
          title: (() => {
            try {
              const filtered = (snapshot?.entries ?? []).filter((e) => e && (e.kind === "ready" || e.kind === "loading"));
              const entries = filtered.length ? filtered : (snapshot?.entries ?? []).filter(Boolean);
              return detailLines({ ...snapshot, entries }).join("\n");
            } catch {
              return lines.join("\n");
            }
          })(),
          "aria-label": "余额 " + text,
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
    /**
     * Client services this plugin needs. Only the slot registry is required:
     * a client plugin that hard-requires a service the shell does not offer
     * stays inactive forever and silently, because the activation simply never
     * runs and nothing is logged. The Remote namespace is therefore read
     * opportunistically instead — a profile without it still renders every
     * host-read route.
     */
    const inject = ["slots"];

    /** The Remote namespace when the shell provides it; `undefined` is supported. */
    function remoteService(ctx) {
      try {
        if (typeof ctx?.get === "function") return ctx.get("remote");
      } catch {
        // A context without the lookup API falls through to the property below.
      }
      return ctx?.remote;
    }

    /**
     * The Remote namespaces this activation reads, resolved on every access so
     * a service that appears after activation is still picked up. `accountSource`
     * already reports an absent namespace as "unavailable" instead of failing.
     */
    function remoteFacade(ctx) {
      return {
        get account() {
          return remoteService(ctx)?.account;
        },
      };
    }

    /**
     * A store that permanently reports one failure. Used when the real store
     * cannot be constructed at all: the control then says so on screen rather
     * than leaving an empty slot the user cannot interpret.
     */
    function brokenStore(message) {
      const snapshot = {
        kind: "failed",
        loading: false,
        at: Date.now(),
        entries: [{ id: PLUGIN_ID, label: "余额", kind: "failed", detail: message, amounts: [], at: Date.now() }],
      };
      return {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        refresh: async () => snapshot,
        dispose: () => {},
      };
    }

    /**
     * Register the balance control into the configured slot (sidebar foot by
     * default) and own the polling store for this plugin activation.
     * @param ctx - client plugin context carrying `slots` (and usually `remote`).
     * @param config - this Loader row's config: `{ slot?, refreshMs? }`.
     */
    function apply(ctx, config) {
      if (ctx?.slots === undefined) {
        throw new Error(PLUGIN_ID + ": the slot registry service is missing — this plugin cannot render without it");
      }
      const settings = config ?? {};
      const slot = typeof settings.slot === "string" && settings.slot !== "" ? settings.slot : DEFAULT_SLOT;
      let store;
      try {
        store = createStore({
          id: PLUGIN_ID,
          remoteSources,
          hostSources,
          remote: remoteFacade(ctx),
          metadata,
          fetchImpl: (...args) => globalThis.fetch(...args),
          refreshMs: settings.refreshMs,
          fallbackRefreshMs: DEFAULT_REFRESH_MS,
          timers: { setInterval: (...args) => globalThis.setInterval(...args), clearInterval: (...args) => globalThis.clearInterval(...args) },
          log: (...args) => globalThis.console.info(...args),
        });
        ctx.effect(() => () => store.dispose(), "route-balance: polling store lifetime");
      } catch (error) {
        store = brokenStore("插件启动失败：" + String(error?.message ?? error));
      }
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
