// Offline harness for the browser half: a minimal stand-in for the DSH client
// module system (`window.__ModuleLoader__`), the platform seed modules
// (`react`, `react/jsx-runtime`) and a few browser globals, enough to load
// lib/client.js, run its `apply()` and mount / re-render the component.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
export const clientBundlePath = path.join(root, 'lib/client.js');
export const clientTemplatePath = path.join(root, 'src', 'client.bundle.js');
export const coreSourcePath = path.join(root, 'lib', 'core.js');
export const registrySourcePath = path.join(root, 'lib', 'registry.js');
export const packageRoot = root;
export const PLUGIN_ID = 'dsh-route-balance';
export const FRAGMENT = Symbol.for('react.fragment');

/** Minimal DOM element stand-in with the APIs the bundle touches. */
export function createElement(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    textContent: '',
    className: '',
    attributes: {},
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((entry) => entry !== child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes[name] = value;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return node;
}

/** Build the browser globals the bundle expects, plus inspectable internals. */
export function createEnvironment() {
  const styles = [];
  const document = {
    head: createElement('head'),
    createElement,
    querySelector(selector) {
      const match = /data-plugin-css="([^"]+)"/.exec(selector ?? '');
      if (!match) return null;
      return styles.find((style) => style.dataset.pluginCss === match[1]) ?? null;
    },
  };
  document.head.appendChild = (node) => {
    styles.push(node);
    return node;
  };

  const intervals = new Map();
  let nextTimer = 1;
  const registry = new Map();

  const sandbox = {
    document,
    navigator: { language: 'zh-CN' },
    console,
    Date,
    BigInt,
    Number,
    String,
    Object,
    Array,
    Map,
    Set,
    Symbol,
    Promise,
    JSON,
    Error,
    Math,
    setInterval: (fn, ms) => {
      const id = nextTimer++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  /** The loader facade: `load({id, factory})` only registers, exactly like the shipped one. */
  const moduleLoader = {
    mode: 'queue',
    registrations: [],
    load(registration) {
      if (!registration || typeof registration.id !== 'string' || typeof registration.factory !== 'function') {
        throw new Error('bad registration');
      }
      if (registry.has(registration.id)) throw new Error(`duplicate registration ${registration.id}`);
      registry.set(registration.id, registration.factory);
      moduleLoader.registrations.push(registration);
    },
  };
  sandbox.__ModuleLoader__ = moduleLoader;

  const react = createReactRuntime();
  const platformModules = {
    react,
    'react/jsx-runtime': react.jsxRuntime,
    [`${PLUGIN_ID}/package.json`]: { version: '0.1.0-test' },
  };
  const requiredExternals = [];
  sandbox.require = (specifier) => {
    requiredExternals.push(specifier);
    if (!(specifier in platformModules)) throw new Error(`unexpected external require("${specifier}")`);
    return platformModules[specifier];
  };

  return {
    sandbox,
    document,
    styles,
    registry,
    moduleLoader,
    react,
    intervals,
    requiredExternals,
    fireInterval(id) {
      const entry = intervals.get(id);
      if (!entry) throw new Error(`no interval ${id}`);
      entry.fn();
    },
    intervalIds: () => [...intervals.keys()],
    /** Run the loaded bundle's factory and return its exports. */
    factory(id = PLUGIN_ID) {
      const factoryFn = registry.get(id);
      if (!factoryFn) throw new Error(`no registered factory for ${id}`);
      return factoryFn(sandbox.require);
    },
  };
}

/**
 * Generate the shipped bundle text in memory — the same pure string transform
 * `tools/build-client.mjs` performs (strip the module doc comment, `import`
 * lines and `export` keywords, indent one level, stamp `__ID__`/`__VERSION__`),
 * but it writes nothing and may legitimately differ from a stale
 * `lib/client.js`.
 *
 * The regression suite loads this so a template or registry change is exercised
 * through the real generated component immediately, not only after a
 * `node tools/build-client.mjs` rebuild.
 *
 * @param options - `{ id?, version? }`; defaults come from `package.json`.
 * @returns the bundle source string.
 */
export function generateBundleSource(options = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const id = options.id ?? pkg.name;
  const version = options.version ?? pkg.version;
  const inline = (file) => fs
    .readFileSync(file, 'utf8')
    .replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')
    .replace(/^import\s[^\n]*\n/gm, '')
    .replace(/^export\s+async\s+function\s/gm, 'async function ')
    .replace(/^export\s+function\s/gm, 'function ')
    .replace(/^export\s+const\s/gm, 'const ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .trim()
    .split('\n')
    .map((line) => (line === '' ? '' : '    ' + line))
    .join('\n');
  return fs
    .readFileSync(clientTemplatePath, 'utf8')
    .replace('    __CORE__', inline(coreSourcePath))
    .replace('    __REGISTRY__', inline(registrySourcePath))
    .replaceAll('__ID__', id)
    .replaceAll('__VERSION__', version);
}

/**
 * Load a bundle into a fresh environment.
 * @param environment - from `createEnvironment()`.
 * @param options - `{ source?, target?, document? }`. `source` defaults to the
 *   shipped `lib/client.js`; pass `generateBundleSource()` to run the current
 *   sources without rebuilding. `target` is the `window` the bundle sees and
 *   defaults to `environment.sandbox`.
 */
export function loadBundle(environment, options = {}) {
  const settings = typeof options === 'string' ? { source: options } : options;
  const source = settings.source ?? fs.readFileSync(clientBundlePath, 'utf8');
  const { sandbox } = environment;
  const target = settings.target ?? sandbox;
  const document = settings.document ?? target.document ?? sandbox.document;
  const run = new Function('window', 'document', 'navigator', 'console', 'setInterval', 'clearInterval', source);
  run(target, document, sandbox.navigator, console, sandbox.setInterval, sandbox.clearInterval);
  return environment;
}

/** React stand-in: the hooks the widget uses plus the automatic jsx runtime. */
export function createReactRuntime() {
  return {
    Fragment: FRAGMENT,
    jsxRuntime: {
      Fragment: FRAGMENT,
      jsx: (type, props) => ({ type, props: props ?? {} }),
      jsxs: (type, props) => ({ type, props: props ?? {} }),
    },
    createElement(type, props, ...children) {
      const flat = children.length > 1 ? children : children[0];
      return { type, props: { ...(props ?? {}), ...(flat === undefined ? {} : { children: flat }) } };
    },
  };
}

/** One mounted component instance: hooks live in `session`, renders are explicit. */
export function createHookSession(react) {
  const session = {
    slots: [],
    cursor: 0,
    effects: [],
    rerender: null,
    renderCount: 0,
  };
  react.useState = (initial) => {
    const slot = session.cursor++;
    if (session.slots[slot] === undefined) session.slots[slot] = typeof initial === 'function' ? initial() : initial;
    const setValue = (next) => {
      const value = typeof next === 'function' ? next(session.slots[slot]) : next;
      if (Object.is(value, session.slots[slot])) return;
      session.slots[slot] = value;
      if (session.rerender) session.rerender();
    };
    return [session.slots[slot], setValue];
  };
  react.useEffect = (effect) => {
    session.effects.push(effect);
  };
  react.useCallback = (fn) => fn;
  react.Fragment = FRAGMENT;
  react.__session = session;
  return session;
}

/**
 * Render one element tree with hook support.
 * @param element - component element (`{type, props}`).
 * @param react - runtime from `createEnvironment().react`.
 * @param session - session from `createHookSession`.
 * @returns `{ nodes, text, cleanups }` for assertions and unmount.
 */
export function renderWithHooks(element, react, session) {
  const nodes = [];
  const text = [];
  session.cursor = 0;
  session.effects = [];
  session.renderCount += 1;

  const walk = (node) => {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') {
      text.push(String(node));
      return { text: String(node) };
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node.type === FRAGMENT) return walk(node.props.children);
    if (typeof node.type === 'function') return walk(node.type(node.props));
    const dom = createElement(node.type);
    const { children, ...rest } = node.props ?? {};
    for (const [key, value] of Object.entries(rest)) {
      if (key === 'onClick') dom.onClick = value;
      else if (key === 'className') dom.className = value;
      else if (key === 'children') continue;
      else dom.attributes[key] = value;
    }
    nodes.push(dom);
    const walked = walk(children);
    dom.children = Array.isArray(walked) ? walked.filter(Boolean) : walked ? [walked] : [];
    return dom;
  };

  const tree = walk(element);
  const cleanups = [];
  for (const effect of session.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  return { tree, nodes, text, cleanups };
}

/** A fake ctx plus the captured slot registration and plugin effects. */
export function createFakeContext(remote) {
  const registrations = [];
  const effects = [];
  const injected = [];
  const context = {
    remote,
    effect(factory, label) {
      const disposer = factory();
      effects.push({ disposer, label });
      return () => {};
    },
    slots: {
      inject(slot, factory) {
        injected.push(slot);
        return factory();
      },
      register(definition, component) {
        registrations.push({ definition, component });
        return () => {
          const index = registrations.findIndex((entry) => entry.definition === definition);
          if (index >= 0) registrations.splice(index, 1);
        };
      },
    },
  };
  return {
    context,
    registrations,
    effects,
    injected,
    dispose() {
      for (const entry of effects) if (typeof entry.disposer === 'function') entry.disposer();
    },
  };
}
