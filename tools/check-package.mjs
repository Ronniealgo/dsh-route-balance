// Static packaging checks. Pure filesystem reads: no network, no `yaml` dependency.
// tools/patch-check.mjs resolves its YAML parser from the DSH profile, which a release
// checkout does not have, so the Loader row is read by the strict mini-parser below.
//
// Every check fails (exit != 0) instead of skipping: a required file that does not exist
// yet is a failure, never a silent pass. `checkPackage` is importable so the synthetic
// fixtures in test/package.test.mjs can drive each check independently.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..');

// Files the published tarball must contain. The runtime half is listed file by file so a
// new lib/*.js module cannot be forgotten; install.ps1 + tools/install-state.mjs +
// tools/patch-check.mjs are what let a user install the published package.
export const SHIPPED_FILES = [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/core.js',
  'lib/registry.js',
  'lib/codex.js',
  'lib/codex-entry.js',
  'cordis.patch.yml',
  'install.ps1',
  'tools/patch-check.mjs',
  'tools/install-state.mjs',
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'LICENSE',
];

// Development-only files that must exist in the repository (they gate a release) but are
// deliberately not packed.
export const REPO_FILES = ['tools/build-client.mjs', 'tools/check-package.mjs', 'tools/run-tests.mjs'];

export const REQUIRED_SOURCE_FILES = [...SHIPPED_FILES, ...REPO_FILES];

// npm always packs package.json, so it is the one entry the `files` allowlist may omit.
export const FILES_ALLOWLIST_REQUIRED = SHIPPED_FILES.filter((file) => file !== 'package.json');

const readText = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (root, rel) => JSON.parse(readText(root, rel));
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const toPosix = (value) => String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- cordis.patch.yml -------------------------------------------------------------------
// A quoted value keeps its '#': only unquoted values lose an inline comment.
export function stripYamlComment(line) {
  const text = String(line);
  if (/^\s*#/.test(text)) return '';
  if (/^\s*(?:-\s*)?[A-Za-z0-9_."'-]+:\s*(['"]).*\1\s*$/.test(text)) return text;
  return text.replace(/\s+#.*$/, '');
}

// Every `name:` scalar of the patch layer, comments ignored. Used instead of a substring
// search so `@scope/dsh-route-balance` cannot satisfy a `dsh-route-balance` Loader row.
export function parseLoaderNames(text) {
  const names = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = stripYamlComment(raw);
    if (line === '') continue;
    const match = /^\s*-\s*name:\s*(.*)$|^\s*name:\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[1] ?? match[2] ?? '').trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2].trim();
    names.push(value);
  }
  return names;
}

// --- lib relative-import closure --------------------------------------------------------
// Approximation: comments are removed first so a quoted path in prose or a URL cannot be
// mistaken for an import. Only relative specifiers are followed; `node:` and bare packages
// are resolved by the DSH host, not by the tarball.
export function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

export function extractSpecifiers(source) {
  const text = stripComments(source);
  const found = new Set();
  const patterns = [
    /\bfrom\s*(['"])([^'"]+)\1/g,
    /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /^\s*import\s*(['"])([^'"]+)\1/gm,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[2]);
  return [...found];
}

export function resolveSpecifier(root, fromRel, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(toPosix(fromRel)), specifier));
  if (base === '..' || base.startsWith('../')) return null;
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, `${base}/index.js`];
  for (const candidate of candidates) if (exists(root, candidate)) return candidate;
  return null;
}

export function collectImportClosure(root, entries) {
  const closure = new Set();
  const missing = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = toPosix(queue.shift());
    if (closure.has(rel)) continue;
    closure.add(rel);
    let source;
    try {
      source = readText(root, rel);
    } catch {
      missing.push({ from: rel, specifier: '(self)', reason: 'unreadable' });
      continue;
    }
    for (const specifier of extractSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolveSpecifier(root, rel, specifier);
      if (target === null) missing.push({ from: rel, specifier, reason: 'does not resolve' });
      else queue.push(target);
    }
  }
  return { closure: [...closure].sort(), missing };
}

// npm `files` semantics: an exact path, a directory prefix, or a glob. A pattern without
// wildcards acts as a directory only when it really is one on disk.
export function filePatternCovers(root, pattern, rel) {
  const target = toPosix(rel);
  const cleaned = toPosix(pattern);
  if (cleaned === '' || path.isAbsolute(pattern)) return false;
  if (cleaned === target) return true;
  if (cleaned.endsWith('/**')) {
    const base = cleaned.slice(0, -3);
    return target === base || target.startsWith(`${base}/`);
  }
  if (!cleaned.includes('*')) {
    const asDirectory = path.join(root, cleaned);
    const isDirectory = fs.existsSync(asDirectory) && fs.statSync(asDirectory).isDirectory();
    return isDirectory && target.startsWith(`${cleaned}/`);
  }
  const regex = new RegExp(`^${cleaned.split('*').map(escapeRegExp).join('[^/]*')}$`);
  return regex.test(target);
}

export function coversAll(root, patterns, rels) {
  return rels.filter((rel) => !patterns.some((pattern) => filePatternCovers(root, pattern, rel)));
}

// --- checks -----------------------------------------------------------------------------
function checkFilesAllowlistShape(root, pkg) {
  const patterns = pkg.files;
  if (!Array.isArray(patterns) || patterns.length === 0) return { ok: false, detail: 'package.json has no `files` allowlist' };
  const problems = [];
  const seen = new Set();
  for (const entry of patterns) {
    if (typeof entry !== 'string' || entry.trim() === '') problems.push(`empty entry ${JSON.stringify(entry)}`);
    else if (seen.has(entry)) problems.push(`duplicate entry ${entry}`);
    else if (path.isAbsolute(entry)) problems.push(`absolute entry ${entry}`);
    else if (toPosix(entry).split('/').includes('..')) problems.push(`parent-relative entry ${entry}`);
    else if (/[\0]/.test(entry)) problems.push(`invalid entry ${JSON.stringify(entry)}`);
    seen.add(entry);
  }
  return { ok: problems.length === 0, detail: problems.length === 0 ? `${patterns.length} explicit allowlist entries` : problems.join('; ') };
}

function checkRequiredFiles(root) {
  const absent = REQUIRED_SOURCE_FILES.filter((rel) => !exists(root, rel));
  if (absent.length > 0) return { ok: false, detail: `missing: ${absent.join(', ')}` };
  const notFile = REQUIRED_SOURCE_FILES.filter((rel) => !fs.statSync(path.join(root, rel)).isFile());
  if (notFile.length > 0) return { ok: false, detail: `not a regular file: ${notFile.join(', ')}` };
  return { ok: true, detail: `${REQUIRED_SOURCE_FILES.length} required files present` };
}

function checkPackageJson(root, pkg) {
  const problems = [];
  if (pkg.type !== 'module') problems.push(`type must be "module" (is ${JSON.stringify(pkg.type)})`);
  if (!/^>=\s*20(\.|$|\s)/.test(String(pkg.engines?.node ?? ''))) problems.push(`engines.node must require Node >= 20 (is ${JSON.stringify(pkg.engines?.node)})`);
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) problems.push(`zero runtime dependencies, found ${Object.keys(pkg.dependencies).join(', ')}`);
  if (pkg.main !== 'lib/index.js') problems.push(`main must be lib/index.js (is ${JSON.stringify(pkg.main)})`);
  if (pkg.exports?.['.'] !== './lib/index.js') problems.push(`exports["."] must be ./lib/index.js (is ${JSON.stringify(pkg.exports?.['.'])})`);
  if (pkg.dsh?.bundle?.patch !== 'cordis.patch.yml') problems.push(`dsh.bundle.patch must be cordis.patch.yml (is ${JSON.stringify(pkg.dsh?.bundle?.patch)})`);
  return { ok: problems.length === 0, detail: problems.length === 0 ? `${pkg.name}@${pkg.version}, ESM, Node >= 20, no runtime dependencies` : problems.join('; ') };
}

function checkLoaderName(root, pkg) {
  const text = readText(root, 'cordis.patch.yml');
  if (!/^\s*-\s*insert:/m.test(text)) return { ok: false, detail: 'cordis.patch.yml has no `- insert:` loader layer' };
  const names = parseLoaderNames(text);
  if (names.length === 0) return { ok: false, detail: 'cordis.patch.yml declares no Loader name' };
  const wrong = names.filter((name) => name !== pkg.name);
  if (wrong.length > 0) {
    return { ok: false, detail: `Loader name must equal ${JSON.stringify(pkg.name)} exactly; found ${wrong.map((name) => JSON.stringify(name)).join(', ')}` };
  }
  return { ok: true, detail: `Loader name === ${pkg.name} (${names.length} row${names.length === 1 ? '' : 's'})` };
}

function checkBundleIdentity(root, pkg) {
  const bundle = readText(root, 'lib/client.js');
  const problems = [];
  if (!new RegExp(`id:\\s*"${escapeRegExp(pkg.name)}"`).test(bundle)) problems.push(`lib/client.js does not register id: "${pkg.name}"`);
  if (!new RegExp(`const VERSION = "${escapeRegExp(pkg.version)}"`).test(bundle)) problems.push(`lib/client.js is not stamped with const VERSION = "${pkg.version}"`);
  return { ok: problems.length === 0, detail: problems.length === 0 ? `bundle id ${pkg.name}, VERSION ${pkg.version}` : problems.join('; ') };
}

function checkChangelog(root, pkg) {
  const changelog = readText(root, 'CHANGELOG.md');
  const versions = [...changelog.matchAll(/^##\s+\[([^\]]+)\]/gm)].map((match) => match[1]);
  if (!new RegExp(`^##\\s+\\[${escapeRegExp(pkg.version)}\\]`, 'm').test(changelog)) {
    return { ok: false, detail: `CHANGELOG.md has no "## [${pkg.version}]" section (found ${versions.join(', ') || 'none'})` };
  }
  return { ok: true, detail: `CHANGELOG.md documents ${pkg.version}` };
}

function checkClientPlatform(root, pkg) {
  const platform = pkg.dsh?.client?.platform;
  if (platform !== 'web') return { ok: false, detail: `dsh.client.platform must be "web" (is ${JSON.stringify(platform)})` };
  const inject = pkg.dsh?.client?.inject;
  if (!Array.isArray(inject) || inject.length === 0) return { ok: false, detail: 'dsh.client.inject must list the injected client packages' };
  return { ok: true, detail: `dsh.client.platform === "web", inject ${inject.length} package${inject.length === 1 ? '' : 's'}` };
}

function checkImportClosure(root, pkg) {
  const patterns = pkg.files;
  if (!Array.isArray(patterns) || patterns.length === 0) return { ok: false, detail: 'package.json has no `files` allowlist' };
  const entries = SHIPPED_FILES.filter((rel) => rel.startsWith('lib/'));
  const { closure, missing } = collectImportClosure(root, entries);
  const problems = [];
  if (missing.length > 0) problems.push(...missing.map((item) => `${item.from} -> ${item.specifier} (${item.reason})`));
  const uncovered = coversAll(root, patterns, closure);
  if (uncovered.length > 0) problems.push(`not covered by \`files\`: ${uncovered.join(', ')}`);
  if (problems.length > 0) return { ok: false, detail: problems.join('; ') };
  return { ok: true, detail: `${closure.length} lib files closed under relative imports and inside \`files\`` };
}

function checkPackedSet(root, pkg) {
  const patterns = pkg.files;
  if (!Array.isArray(patterns) || patterns.length === 0) return { ok: false, detail: 'package.json has no `files` allowlist' };
  const uncovered = coversAll(root, patterns, FILES_ALLOWLIST_REQUIRED);
  if (uncovered.length > 0) return { ok: false, detail: `\`files\` does not ship: ${uncovered.join(', ')}` };
  return { ok: true, detail: `${FILES_ALLOWLIST_REQUIRED.length} shipped files reachable through \`files\`` };
}

function checkPublishIdentity(root, pkg) {
  // Owned by the maintainer, not by this checker: the repository/bugs/homepage fields.
  const placeholders = ['repository.url', 'bugs.url', 'homepage'].filter((field) => {
    const value = field.split('.').reduce((node, key) => node?.[key], pkg);
    return typeof value === 'string' && /github\.com\/OWNER\//.test(value);
  });
  if (placeholders.length > 0) return { ok: false, detail: `placeholder publish identity in ${placeholders.join(', ')} (github.com/OWNER)` };
  return { ok: true, detail: 'publish identity is not a placeholder' };
}

export const CHECKS = [
  ['required-files', checkRequiredFiles],
  ['package-json', checkPackageJson],
  ['files-allowlist-shape', checkFilesAllowlistShape],
  ['loader-name-exact', checkLoaderName],
  ['bundle-identity', checkBundleIdentity],
  ['changelog-current', checkChangelog],
  ['dsh-client-platform', checkClientPlatform],
  ['lib-import-closure', checkImportClosure],
  ['packed-set', checkPackedSet],
  ['publish-identity', checkPublishIdentity],
];

export function checkPackage(root = DEFAULT_ROOT) {
  const checks = [];
  let pkg = null;
  try {
    pkg = readJson(root, 'package.json');
  } catch (error) {
    checks.push({ name: 'package-json', ok: false, detail: `cannot read package.json: ${error.message}` });
  }
  for (const [name, run] of CHECKS) {
    if (name === 'package-json' && pkg === null) continue;
    try {
      const result = run(root, pkg);
      checks.push({ name, ok: result.ok !== false, detail: result.detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: error.message });
    }
  }
  const issues = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  return {
    root,
    ok: issues.length === 0,
    passed: issues.length === 0,
    issues,
    name: pkg?.name ?? null,
    version: pkg?.version ?? null,
    expectedFiles: Array.isArray(pkg?.files) ? [...pkg.files].sort() : [],
    checks,
  };
}

export function formatReport(result) {
  const lines = result.checks.map((check) => `${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
  const failed = result.checks.filter((check) => !check.ok).length;
  lines.push(`check-package: ${result.checks.length - failed}/${result.checks.length} checks passed in ${result.root}`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at >= 0 ? path.resolve(args[at + 1]) : DEFAULT_ROOT;
  const result = checkPackage(root);
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : formatReport(result));
  process.exitCode = result.ok ? 0 : 1;
}
