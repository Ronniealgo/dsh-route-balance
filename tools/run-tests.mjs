// Sequential test runner: one real child process per test file, exit code decides.
// `node --test test/` is not used on purpose: it spawns its own child per file, which
// fails with `spawn EPERM` under the Windows workspace-write sandbox, and nesting it
// inside our runner would double the process tree.
//
// Auto-discovery includes the runner regression suite. That suite only invokes
// synthetic directories, never this repository's test directory, so it cannot
// recursively execute itself. Explicit file arguments are also supported.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
// Self-tests execute only synthetic directories, so they cannot recurse into this suite.
export const SELF_TEST_BASENAMES = [];
export const OFFLINE_GUARD = path.join(HERE, 'offline-guard.cjs');
export const DEFAULT_TIMEOUT_MS = 120_000;

export function discoverTestFiles(directory, options = {}) {
  const skip = new Set(options.skip ?? SELF_TEST_BASENAMES);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`not a test directory: ${directory}`);
  }
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.test.mjs'))
    .filter((name) => !skip.has(name))
    .sort()
    .map((name) => path.resolve(directory, name));
}

export function runTests(directory = path.join(ROOT, 'test'), options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ?? ROOT;
  const nodePath = options.nodePath ?? process.execPath;
  if (options.offlineGuard !== false && !fs.existsSync(OFFLINE_GUARD)) {
    throw new Error('Offline guard is missing; refuse to run the release suite without it');
  }
  const guard = options.offlineGuard === false ? [] : ['--require', OFFLINE_GUARD];
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|BROWSER_COOKIE|ACCESS_TOKEN|SESSION_SECRET)$/i.test(key)));
  const env = {
    ...inherited,
    ...(options.env ?? {}),
    DSH_ROUTE_BALANCE_TEST: '1',
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
  };
  let files;
  try {
    files = options.files ?? discoverTestFiles(directory, options);
  } catch (error) {
    console.error(error.message);
    return { dir: directory, files: 0, passed: 0, failed: 1, results: [{ file: null, exitCode: null, ok: false, error: error.message }] };
  }
  if (files.length === 0) {
    console.error(`No test files found in ${directory}`);
    return { dir: directory, files: 0, passed: 0, failed: 1, results: [] };
  }
  const results = [];
  for (const file of files.map((entry) => path.resolve(entry))) {
    const label = path.relative(cwd, file) || file;
    console.log(`\n=== ${label} ===`);
    const startedAt = Date.now();
    const result = spawnSync(nodePath, [...guard, file], {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      env,
    });
    const durationMs = Date.now() - startedAt;
    const timedOut = result.error?.code === 'ETIMEDOUT';
    const exitCode = result.status ?? null;
    const ok = exitCode === 0 && !result.error;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (!ok) {
      const reason = timedOut ? `timeout after ${timeoutMs}ms` : result.error ? `${result.error.code ?? 'error'}: ${result.error.message}` : `exit=${exitCode}`;
      console.error(`FAILED ${label}: ${reason} (${durationMs}ms)`);
    } else {
      console.log(`PASSED ${label} (${durationMs}ms)`);
    }
    const cases = {};
    for (const match of String(result.stdout ?? '').matchAll(/^(?:ℹ|#)\s+(tests|pass|fail|cancelled|skipped)\s+(\d+)\b/gm)) cases[match[1]] = Number(match[2]);
    results.push({ file, label, exitCode, signal: result.signal ?? null, ok, timedOut, durationMs, cases });
  }
  const summary = { dir: directory, files: results.length, passed: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length, results };
  summary.cases = results.reduce((total, result) => {
    for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) total[key] += result.cases[key] ?? 0;
    return total;
  }, { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 });
  console.log(`CASE_SUMMARY ${JSON.stringify(summary.cases)}`);
  // Kept from the first version of this file: machine-readable trailer.
  console.log(`FILE_SUMMARY ${JSON.stringify({ files: summary.files, passed: summary.passed, failed: summary.failed })}`);
  if (summary.failed > 0) console.error(`run-tests: ${summary.failed}/${summary.files} file(s) failed`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--dir');
  const timeoutAt = args.indexOf('--timeout');
  const timeoutMs = timeoutAt >= 0 ? Number(args[timeoutAt + 1]) : undefined;
  const explicit = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--dir' && args[index - 1] !== '--timeout');
  const directory = at >= 0 ? path.resolve(args[at + 1]) : path.join(ROOT, 'test');
  try {
    const files = explicit.length > 0 ? explicit : undefined;
    const summary = runTests(directory, { files, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined });
    process.exitCode = summary.failed > 0 ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
