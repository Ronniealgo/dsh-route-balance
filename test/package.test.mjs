// Packaging tests.
//
// 1. Synthetic fixtures drive tools/check-package.mjs one check at a time, in temporary
//    directories that never touch this repository.
// 2. A real `npm pack --ignore-scripts --json` produces the tarball, the system `tar`
//    unpacks it, and the unpacked lib/index.js is imported (never applied). No registry
//    access and no `npm install`: the npm cache is redirected into the temp directory,
//    proxy/auth environment is stripped and npm runs with --offline.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPackage, formatReport, parseLoaderNames, FILES_ALLOWLIST_REQUIRED, REQUIRED_SOURCE_FILES } from "../tools/check-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_NAME = "dsh-fixture-package";
const FIXTURE_VERSION = "9.9.9";

// --- synthetic fixture ------------------------------------------------------------------

const FIXTURE_FILE_LIST = [
  "lib/index.js",
  "lib/client.js",
  "lib/core.js",
  "lib/registry.js",
  "lib/codex.js",
  "lib/codex-entry.js",
  "cordis.patch.yml",
  "install.ps1",
  "tools/patch-check.mjs",
  "tools/install-state.mjs",
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "LICENSE",
];

function fixturePackage(mutate = (pkg) => pkg) {
  const pkg = {
    name: FIXTURE_NAME,
    version: FIXTURE_VERSION,
    type: "module",
    main: "lib/index.js",
    exports: { ".": "./lib/index.js", "./client": "./lib/client.js" },
    files: [...FIXTURE_FILE_LIST],
    engines: { node: ">=20" },
    repository: { type: "git", url: "git+https://example.com/fixture.git" },
    bugs: { url: "https://example.com/fixture/issues" },
    homepage: "https://example.com/fixture#readme",
    dsh: {
      bundle: { patch: "cordis.patch.yml" },
      client: { inject: ["fixture-renderer"], platform: "web" },
    },
  };
  return `${JSON.stringify(mutate(pkg), null, 2)}\n`;
}

function fixtureTree(overrides = {}) {
  const files = {
    "package.json": fixturePackage(),
    "cordis.patch.yml": `- insert:\n    - id: fixture\n      name: "${FIXTURE_NAME}"\n      config:\n        slot: sidebar.footer.action\n`,
    "lib/index.js": "import { value } from './core.js';\nexport const use = value;\nexport function apply() {}\n",
    "lib/client.js": `// generated\nconst registration = { id: "${FIXTURE_NAME}" };\nconst VERSION = "${FIXTURE_VERSION}";\nexport { registration, VERSION };\n`,
    "lib/core.js": "export const value = 1;\n",
    "lib/registry.js": "export const registry = {};\n",
    "lib/codex.js": "export const codex = 1;\n",
    "lib/codex-entry.js": "import { codex } from './codex.js';\nexport const entry = codex;\n",
    "install.ps1": "# fixture installer\n",
    "tools/patch-check.mjs": "export const parsePatch = () => [];\n",
    "tools/install-state.mjs": "export const state = {};\n",
    "tools/build-client.mjs": "// fixture build tool\n",
    "tools/check-package.mjs": "// fixture checker\n",
    "tools/run-tests.mjs": "// fixture runner\n",
    "README.md": "# fixture\n",
    "CHANGELOG.md": `## [${FIXTURE_VERSION}] - 2026-01-01\n\n- fixture\n`,
    "SECURITY.md": "# fixture security\n",
    LICENSE: "MIT\n",
  };
  for (const [name, body] of Object.entries(overrides)) {
    if (body === null) delete files[name];
    else files[name] = body;
  }
  return files;
}

function materialize(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dshrb-check-"));
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return dir;
}

function cleanupTemporary(dir, prefix) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith(prefix));
  fs.rmSync(dir, { recursive: true, force: true });
}

function runFixture(overrides = {}) {
  const dir = materialize(fixtureTree(overrides));
  try {
    return { dir, result: checkPackage(dir) };
  } finally {
    cleanupTemporary(dir, 'dshrb-check-');
  }
}

function checkOf(result, name) {
  const found = result.checks.find((check) => check.name === name);
  assert.ok(found, `check ${name} missing from ${result.checks.map((check) => check.name).join(", ")}`);
  return found;
}

test("check-package: the smallest complete synthetic package passes every check", () => {
  const { result } = runFixture();
  assert.equal(result.ok, true, formatReport(result));
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.name, FIXTURE_NAME);
  assert.equal(result.version, FIXTURE_VERSION);
});

test("check-package: the explicit file lists still demand the installer and the docs", () => {
  for (const file of ["install.ps1", "tools/install-state.mjs", "tools/patch-check.mjs", "cordis.patch.yml", "SECURITY.md", "CHANGELOG.md", "LICENSE", "README.md", "lib/codex-entry.js", "lib/codex.js"]) {
    assert.ok(FILES_ALLOWLIST_REQUIRED.includes(file), `${file} must be shipped through \`files\``);
    assert.ok(REQUIRED_SOURCE_FILES.includes(file), `${file} must exist in the repository`);
  }
});

test("check-package: a missing required file fails instead of being skipped", () => {
  const files = fixtureTree();
  delete files["tools/install-state.mjs"];
  files["package.json"] = fixturePackage((pkg) => ({ ...pkg, files: pkg.files.filter((entry) => entry !== "tools/install-state.mjs") }));
  const dir = materialize(files);
  try {
    const result = checkPackage(dir);
    assert.equal(result.ok, false);
    const check = checkOf(result, "required-files");
    assert.equal(check.ok, false);
    assert.match(check.detail, /tools\/install-state\.mjs/);
  } finally {
    cleanupTemporary(dir, 'dshrb-check-');
  }
});

test("check-package: a Loader name that merely contains the package name is rejected", () => {
  const patch = `- insert:\n    - id: fixture\n      name: "@scope/${FIXTURE_NAME}"\n`;
  assert.ok(patch.includes(FIXTURE_NAME), "the wrong name really does contain the package name");
  const { result } = runFixture({ "cordis.patch.yml": patch });
  assert.equal(result.ok, false);
  const check = checkOf(result, "loader-name-exact");
  assert.equal(check.ok, false);
  assert.match(check.detail, /exactly/);
});

test("check-package: an unquoted Loader name is still read exactly", () => {
  const { result } = runFixture({ "cordis.patch.yml": `- insert:\n    - id: fixture\n      name: ${FIXTURE_NAME} # inline note\n` });
  const check = checkOf(result, "loader-name-exact");
  assert.equal(check.ok, true, check.detail);
});

test("check-package: a CHANGELOG without the current version is rejected", () => {
  const { result } = runFixture({ "CHANGELOG.md": "## [0.0.1] - 2020-01-01\n\n- old\n" });
  assert.equal(result.ok, false);
  const check = checkOf(result, "changelog-current");
  assert.equal(check.ok, false);
  assert.match(check.detail, new RegExp(FIXTURE_VERSION.replace(/\./g, "\\.")));
});

test("check-package: a client platform other than web is rejected", () => {
  const pkg = fixturePackage((next) => ({ ...next, dsh: { ...next.dsh, client: { ...next.dsh.client, platform: "node" } } }));
  const { result } = runFixture({ "package.json": pkg });
  assert.equal(result.ok, false);
  assert.equal(checkOf(result, "dsh-client-platform").ok, false);
});

test("check-package: an import that leaves `files` is rejected", () => {
  const unlisted = runFixture({ "lib/index.js": "import { hidden } from './hidden.js';\nexport const use = hidden;\n", "lib/hidden.js": "export const hidden = 1;\n" });
  assert.equal(unlisted.result.ok, false);
  const uncovered = checkOf(unlisted.result, "lib-import-closure");
  assert.equal(uncovered.ok, false);
  assert.match(uncovered.detail, /hidden\.js/);

  const dangling = runFixture({ "lib/index.js": "import { gone } from './gone.js';\nexport const use = gone;\n" });
  assert.equal(dangling.result.ok, false);
  assert.match(checkOf(dangling.result, "lib-import-closure").detail, /does not resolve/);
});

test("check-package: a bundle stamp that does not match package.json is rejected", () => {
  const { result } = runFixture({ "lib/client.js": `const VERSION = "0.0.0";\nconst registration = { id: "${FIXTURE_NAME}" };\n` });
  assert.equal(result.ok, false);
  const check = checkOf(result, "bundle-identity");
  assert.equal(check.ok, false);
  assert.match(check.detail, /VERSION/);
});

test("check-package: docs that are not shipped through `files` are rejected", () => {
  const pkg = fixturePackage((next) => ({ ...next, files: next.files.filter((entry) => !["README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md"].includes(entry)) }));
  const { result } = runFixture({ "package.json": pkg });
  assert.equal(result.ok, false);
  const check = checkOf(result, "packed-set");
  assert.equal(check.ok, false);
  for (const file of ["README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md"]) assert.match(check.detail, new RegExp(file.replace(".", "\\.")));
});

test("check-package: this repository is packageable", () => {
  const result = checkPackage(ROOT);
  assert.equal(result.ok, true, formatReport(result));
});

// --- real npm pack ----------------------------------------------------------------------

const STRIPPED_ENV = /^(?:npm_config_(?:proxy|https?-proxy|always-auth|_auth|_authtoken|otp|email|username|password|scope)|http_proxy|https_proxy|all_proxy|no_proxy|node_auth_token|npm_token)$/i;

export function sanitizeNpmEnv(base, { cache, userConfig, globalConfig, registry = "http://127.0.0.1:9/" }) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (STRIPPED_ENV.test(key)) continue;
    if (key.toUpperCase().startsWith("YARN_")) continue;
    env[key] = value;
  }
  env.npm_config_cache = cache;
  env.npm_config_userconfig = userConfig;
  // Must be a different file: npm aborts with "double-loading config" when the user and
  // global config resolve to the same path.
  env.npm_config_globalconfig = globalConfig ?? userConfig;
  env.npm_config_registry = registry;
  env.npm_config_offline = "true";
  env.npm_config_ignore_scripts = "true";
  env.npm_config_audit = "false";
  env.npm_config_fund = "false";
  env.npm_config_update_notifier = "false";
  env.npm_config_loglevel = "error";
  env.npm_config_yes = "true";
  return env;
}

// npm.cmd cannot be launched with execFile on Windows, so the CLI entry (`npm-cli.js`) is
// preferred; the .cmd shim is only a last resort, launched through cmd.exe.
export function resolveNpmInvocation() {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.(?:js|cjs|mjs)$/.test(execPath) && fs.existsSync(execPath)) {
    return { command: process.execPath, args: [execPath], source: "npm_execpath" };
  }
  const nodeDir = path.dirname(process.execPath);
  const cliCandidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of cliCandidates) {
    if (fs.existsSync(candidate)) return { command: process.execPath, args: [candidate], source: candidate };
  }
  if (process.platform === "win32") {
    const shim = [path.join(nodeDir, "npm.cmd"), path.join(nodeDir, "..", "npm.cmd")].find((candidate) => fs.existsSync(candidate));
    if (shim) return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${shim}"`], source: shim };
    throw new Error("no npm CLI found next to the running node.exe; cannot run npm pack");
  }
  return { command: "npm", args: [], source: "PATH" };
}

function parsePackJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`npm pack --json produced no JSON array:\n${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

test("package: npm pack ships a complete tarball whose host half imports", { timeout: 240000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshrb-pack-"));
  try {
    const cache = path.join(tmp, "npm-cache");
    const userConfig = path.join(tmp, "empty-user.npmrc");
    const globalConfig = path.join(tmp, "empty-global.npmrc");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(userConfig, "");
    fs.writeFileSync(globalConfig, "");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const invocation = resolveNpmInvocation();
    const packed = spawnSync(invocation.command, [...invocation.args, "pack", "--ignore-scripts", "--json", "--pack-destination", tmp], {
      cwd: ROOT,
      env: sanitizeNpmEnv(process.env, { cache, userConfig, globalConfig }),
      encoding: "utf8",
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(packed.error, undefined, `npm pack could not start: ${packed.error?.message}`);
    assert.equal(packed.status, 0, `npm pack failed (${packed.status}):\n${packed.stderr}`);

    const entries = parsePackJson(packed.stdout);
    assert.equal(entries.length, 1, `expected one tarball, got ${entries.length}`);
    const entry = entries[0];
    assert.equal(entry.name, pkg.name);
    assert.equal(entry.version, pkg.version);
    assert.ok(entry.filename.endsWith(".tgz"), entry.filename);

    const packedNames = new Set(entry.files.map((file) => String(file.path).replace(/^\.\//, "")));
    assert.deepEqual([...packedNames].sort(), [...new Set(['package.json', ...pkg.files])].sort(), 'actual tarball must match the entire explicit file list');
    for (const required of [...FILES_ALLOWLIST_REQUIRED, "package.json"]) {
      assert.ok(packedNames.has(required), `${required} is missing from the tarball (${[...packedNames].join(", ")})`);
    }
    const strays = [...packedNames].filter((name) => /^(?:test|src|docs)\//.test(name));
    assert.deepEqual(strays, [], "the tarball must not ship the test, src or docs trees");

    const extract = path.join(tmp, "extract");
    fs.mkdirSync(extract);
    // Relative paths on purpose: bsdtar on Windows treats "C:\..." as a remote host spec.
    const untarred = spawnSync("tar", ["-xzf", entry.filename, "-C", "extract"], { cwd: tmp, encoding: "utf8", timeout: 60000, windowsHide: true });
    assert.equal(untarred.error, undefined, `tar could not start: ${untarred.error?.message}`);
    assert.equal(untarred.status, 0, `tar failed (${untarred.status}):\n${untarred.stderr}`);

    const unpacked = path.join(extract, "package");
    const unpackedPkg = JSON.parse(fs.readFileSync(path.join(unpacked, "package.json"), "utf8"));
    assert.equal(unpackedPkg.name, pkg.name);
    assert.equal(unpackedPkg.version, pkg.version);

    const shippedPatch = fs.readFileSync(path.join(unpacked, "cordis.patch.yml"), "utf8");
    assert.deepEqual(parseLoaderNames(shippedPatch), [pkg.name], "the shipped Loader row must name the package exactly");

    // Import only: `apply` is never called, so no host service is registered.
    const hostHalf = await import(pathToFileURL(path.join(unpacked, "lib", "index.js")).href);
    const apply = hostHalf.apply ?? hostHalf.default?.apply;
    assert.equal(typeof apply, "function", "the unpacked host half must export apply()");
    const installer = await import(pathToFileURL(path.join(unpacked, 'tools', 'install-state.mjs')).href);
    assert.equal(typeof installer.installPackage, 'function', 'the packed installer import closure must also be complete');
  } finally {
    cleanupTemporary(tmp, 'dshrb-pack-');
  }
});
