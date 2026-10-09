/**
 * Read quota through Codex's app-server protocol, never through inference.
 * No auth.json inspection and no token/error/stderr forwarding. In auto mode
 * the installed Codex process may use its own credentials and write runtime
 * state inside CODEX_HOME; this module does not make it a disk-read-only process.
 */
import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isNumeric } from './core.js';

export const CODEX_DEFAULTS = Object.freeze({ strategy: 'auto', warmMs: 240000, timeoutMs: 20000, snapshotPath: null });
const REASONS = Object.freeze({
  'codex-not-found': '没找到 Codex CLI 或桌面版',
  'codex-not-signed-in': 'Codex 未登录 ChatGPT，请先在 Codex 中登录',
  'codex-api-key-account': '当前 Codex 使用 API Key，不是 ChatGPT 订阅',
  'codex-spawn-failed': 'Codex 启动失败，请检查本机安装及进程权限',
  'codex-invalid-command': 'Codex 启动路径含不支持的命令字符',
  'codex-init-failed': 'Codex 初始化被拒绝或返回了无效响应',
  'codex-no-answer': 'Codex 没有在时限内回答',
  'codex-stream-error': 'Codex 通信管道已关闭或发生错误',
  'codex-exited': 'Codex 在回答完成前退出',
  'codex-refused': 'Codex 拒绝了额度查询',
  'codex-empty': 'Codex 没返回有效的额度窗口',
  'codex-invalid-snapshot': '没有可用的额度快照',
  'codex-disabled': '已关闭（strategy: off）',
  'codex-cancelled': '额度读取已取消',
  'codex-reader-threw': '额度读取失败',
  'codex-protocol-limit': 'Codex 响应超过安全大小限制',
});
export function failure(reason) {
  const code = Object.hasOwn(REASONS, reason) ? reason : 'codex-reader-threw';
  return { ok: false, reason: code, detail: REASONS[code] };
}
const numeric = (v) => isNumeric(v) ? Number(v) : null;
const planName = (v) => typeof v === 'string' && /^[a-z0-9_-]{1,32}$/i.test(v) ? v : null;
const fileName = (v) => String(v ?? '').split(/[\\/]/).at(-1)?.slice(0, 80) ?? '';

export function needsShell(file, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(file);
}
export function codexCandidates(env = process.env, home = homedir(), platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const direct = [], shims = [], pinned = [], seen = new Set();
  const push = (file, first = false) => {
    if (typeof file !== 'string' || file === '' || seen.has(file)) return;
    seen.add(file);
    const entry = { path: file, shell: needsShell(file, platform) };
    (first ? pinned : entry.shell ? shims : direct).push(entry);
  };
  push(env.CODEX_BIN, true);
  if (platform === 'win32') {
    const root = p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    try {
      const installed = readdirSync(root).map((dir) => p.join(root, dir, 'codex.exe'));
      const dated = installed.flatMap((file) => { try { return [{ file, at: statSync(file).mtimeMs }]; } catch { return []; } });
      dated.sort((a, b) => b.at - a.at).forEach(({ file }) => push(file));
    } catch { /* Discovery failure is not an authentication signal. */ }
  } else {
    ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', p.join(home, '.local/bin/codex'), p.join(home, '.npm-global/bin/codex')].forEach((f) => push(f));
  }
  for (const dir of String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const name of platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex']) push(p.join(dir, name));
  }
  if (platform === 'win32') {
    const root = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    for (const name of ['codex.exe', 'codex.cmd']) push(p.join(root, 'npm', name));
  }
  return [...pinned, ...direct, ...shims];
}
export function existingCodexCandidates(env = process.env, home = homedir(), platform = process.platform) {
  return codexCandidates(env, home, platform).filter((candidate) => {
    try { return statSync(candidate.path).isFile(); } catch { return false; }
  });
}
export function findCodexExe(candidates = existingCodexCandidates()) {
  for (const item of candidates) {
    const file = typeof item === 'string' ? item : item?.path;
    if (typeof file !== 'string' || !existsSync(file)) continue;
    if (/\.(cmd|bat)$/i.test(file) && existsSync(file.replace(/\.(cmd|bat)$/i, '.exe'))) return { path: file.replace(/\.(cmd|bat)$/i, '.exe'), shell: false };
    return { path: file, shell: typeof item === 'string' ? needsShell(file) : item.shell === true };
  }
  return null;
}
export function defaultSnapshotPath(env = process.env, home = homedir()) {
  const target = env.CODEX_QUOTA_SNAPSHOT || path.join(env.CODEX_HOME || path.join(home, '.codex'), 'rate-limits.snapshot.json');
  return existsSync(target) ? target : null;
}
export function windowLabel(minutes) {
  if (typeof minutes === 'string' && /^\d+(?:\.\d+)?[hm]$/.test(minutes)) minutes = Number(minutes.slice(0, -1)) * (minutes.endsWith('h') ? 60 : 1);
  if (!Number.isFinite(minutes) || minutes <= 0) return '额度窗口';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时窗口`;
  return `${minutes} 分钟窗口`;
}
function normalizeWindow(entry, legacy = false) {
  if (entry === null || typeof entry !== 'object') return null;
  let used = numeric(entry.usedPercent);
  if (legacy && used === null && typeof entry.used === 'string' && /^\d+(?:\.\d+)?%$/.test(entry.used)) used = Number(entry.used.slice(0, -1));
  if (used === null || used < 0 || used > 100) return null;
  let minutes = numeric(legacy ? entry.windowMinutes ?? entry.windowDurationMins : entry.windowDurationMins);
  if (legacy && minutes === null && typeof entry.window === 'string' && /^\d+(?:\.\d+)?[hm]$/.test(entry.window)) minutes = Number(entry.window.slice(0, -1)) * (entry.window.endsWith('h') ? 60 : 1);
  if (minutes !== null && (minutes <= 0 || minutes > 5256000)) minutes = null;
  const reset = numeric(entry.resetsAt);
  const left = Number((100 - used).toFixed(6));
  return { used: `${used}%`, usedPercent: used, remaining: `${left}%`, remainingPercent: left,
    windowMinutes: minutes, windowName: windowLabel(minutes), resetsAt: reset !== null && reset > 0 && reset < 8640000000000 ? reset : null };
}
function normalizedPools(pools, legacy) {
  if (pools === null || typeof pools !== 'object' || Array.isArray(pools)) return null;
  const result = {};
  for (const [id, pool] of Object.entries(pools)) {
    if (!/^[a-z0-9_.-]{1,64}$/i.test(id) || pool === null || typeof pool !== 'object') continue;
    const raw = legacy ? (Array.isArray(pool.windows) ? pool.windows : [pool.fiveHour, pool.weekly]) : [pool.primary, pool.secondary];
    const windows = raw.map((w) => normalizeWindow(w, legacy)).filter(Boolean).sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0));
    if (!windows.length) continue;
    const credits = pool.credits;
    result[id] = { windows, window: windows.at(-1), fiveHour: windows.find((w) => w.windowMinutes === 300) ?? null,
      weekly: windows.find((w) => w.windowMinutes === 10080) ?? null, planType: planName(pool.planType),
      credits: credits && typeof credits === 'object' ? { hasCredits: credits.hasCredits === true, unlimited: credits.unlimited === true, balance: numeric(credits.balance) } : null };
  }
  return Object.keys(result).length ? result : null;
}
export function summarizeRateLimits(reply) {
  const result = reply?.result ?? reply;
  const pools = normalizedPools(result?.rateLimitsByLimitId ?? (result?.rateLimits ? { codex: result.rateLimits } : null), false);
  if (!pools) return null;
  const count = numeric(result?.rateLimitResetCredits?.availableCount);
  return { pools, planType: planName(result?.rateLimits?.planType) ?? Object.values(pools)[0].planType,
    resetCredits: Number.isInteger(count) && count >= 0 ? { availableCount: count } : null };
}
export function tightestWindow(result) {
  if (result?.ok !== true) return null;
  let best = null;
  for (const pool of Object.values(result.quota?.pools ?? {})) {
    for (const raw of (Array.isArray(pool?.windows) ? pool.windows : [pool?.fiveHour, pool?.weekly])) {
      const w = normalizeWindow(raw, true);
      if (w && (!best || w.remainingPercent < best.remainingPercent || (w.remainingPercent === best.remainingPercent && (w.windowMinutes ?? 0) > (best.windowMinutes ?? 0)))) best = w;
    }
  }
  return best;
}
export const remainingPercent = (result) => tightestWindow(result)?.remainingPercent ?? null;
export function describeRemaining(result) {
  const w = tightestWindow(result);
  return w ? `还剩 ${w.remainingPercent}%（${w.windowName}）` : null;
}
// The displayed reset belongs to the limiting window, never an unrelated earlier one.
export const nextResetAt = (result) => tightestWindow(result)?.resetsAt ?? null;
export function describeCodexQuota(result) {
  if (result?.ok !== true) return failure(result?.reason).detail;
  const parts = [];
  for (const pool of Object.values(result.quota?.pools ?? {})) {
    for (const raw of (Array.isArray(pool?.windows) ? pool.windows : [pool?.fiveHour, pool?.weekly])) {
      const w = normalizeWindow(raw, true);
      if (w) parts.push(`${w.windowName} 还剩 ${w.remainingPercent}%（已用 ${w.usedPercent}%）`);
    }
  }
  const coupons = numeric(result.quota?.resetCredits?.availableCount);
  if (Number.isInteger(coupons) && coupons > 0) parts.push(`重置券 ${coupons} 张`);
  if (result.source === 'snapshot') parts.push('手动快照，非实时账户读数');
  return parts.join(' · ') || '没有可用的额度窗口';
}

/** Use cmd.exe's quoting, not C-runtime backslash quoting, for Windows shims. */
export function toSpawnCommand(found, args, env = process.env) {
  const exe = typeof found === 'string' ? found : found?.path;
  if (typeof exe !== 'string' || exe === '' || /[\r\n\0]/.test(exe)) throw new Error('codex-invalid-command');
  const shell = typeof found === 'string' ? needsShell(found) : found.shell === true;
  if (!shell) return { file: exe, argv: args, options: {} };
  if ([exe, ...args].some((s) => /["%!^&|<>\r\n\0]/.test(s))) throw new Error('codex-invalid-command');
  return { file: env.ComSpec || 'cmd.exe', argv: ['/d', '/s', '/c', `""${exe}" ${args.map((s) => `"${s}"`).join(' ')}"`], options: { windowsVerbatimArguments: true } };
}
function terminate(child, native, killImpl) {
  try {
    if (killImpl) { killImpl(child); return; }
    if (native && Number.isInteger(child.pid) && child.pid > 0) {
      if (process.platform === 'win32') {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 2000 });
        return;
      }
      process.kill(-child.pid, 'SIGTERM');
      return;
    }
  } catch { /* Already exited, or tree termination is unavailable. */ }
  try { child.kill?.(); } catch { /* Nothing more to terminate. */ }
}
async function runSession(candidate, options) {
  let command;
  try { command = toSpawnCommand(candidate, ['app-server', '--listen', 'stdio://'], options.env ?? process.env); }
  catch { return failure('codex-invalid-command'); }
  if (options.signal?.aborted) return failure('codex-cancelled');
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  let child;
  try {
    child = spawnImpl(command.file, command.argv, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      detached: spawnImpl === nodeSpawn && process.platform !== 'win32', env: options.env ?? process.env, ...command.options });
  } catch { return failure('codex-spawn-failed'); }
  const pending = new Map();
  let stopped = null, buffer = '', total = 0, timer;
  const fail = (code) => {
    if (stopped) return;
    stopped = code;
    for (const waiter of pending.values()) waiter.reject(code);
    pending.clear();
  };
  const onAbort = () => fail('codex-cancelled');
  child.on?.('error', () => fail('codex-spawn-failed'));
  child.on?.('exit', () => fail('codex-exited'));
  child.on?.('close', () => fail('codex-exited'));
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on?.('error', () => fail('codex-stream-error'));
  child.stderr?.on?.('data', () => {}); // Drain without retaining or returning raw stderr.
  child.stdout?.on?.('data', (chunk) => {
    if (stopped) return;
    total += chunk.length;
    if (total > 2 * 1024 * 1024) { fail('codex-protocol-limit'); return; }
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      try {
        const reply = JSON.parse(line), waiter = pending.get(reply?.id);
        if (waiter) { pending.delete(reply.id); waiter.resolve(reply); }
      } catch { /* Bounded non-protocol chatter is ignored. */ }
    }
  });
  const send = (message) => {
    if (stopped) throw stopped;
    if (typeof child.stdin?.write !== 'function') { fail('codex-stream-error'); throw stopped; }
    try { child.stdin.write(`${JSON.stringify(message)}\n`, (err) => { if (err) fail('codex-stream-error'); }); }
    catch { fail('codex-stream-error'); throw stopped; }
  };
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    if (stopped) { reject(stopped); return; }
    pending.set(id, { resolve, reject });
    try { send({ jsonrpc: '2.0', id, method, params }); } catch (code) { pending.delete(id); reject(code); }
  });
  timer = setTimeout(() => fail('codex-no-answer'), options.timeoutMs);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  try {
    const init = await request(1, 'initialize', { clientInfo: { name: 'dsh-route-balance', version: '1' } });
    if (init.error || !init.result || typeof init.result !== 'object') return failure('codex-init-failed');
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    const account = await request(2, 'account/read', { refreshToken: false });
    if (account.error) return failure('codex-refused');
    if (!account.result?.account) return failure('codex-not-signed-in');
    if (account.result.account.type !== 'chatgpt') return failure('codex-api-key-account');
    const answer = await request(3, 'account/rateLimits/read');
    if (answer.error) return failure('codex-refused');
    const quota = summarizeRateLimits(answer);
    if (!quota) return failure('codex-empty');
    return { ok: true, quota: { ...quota, accountPlan: planName(account.result.account.planType) },
      readAt: new Date().toISOString(), executable: fileName(candidate.path) };
  } catch (code) { return failure(typeof code === 'string' ? code : 'codex-reader-threw'); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    stopped = stopped ?? 'codex-cancelled';
    terminate(child, spawnImpl === nodeSpawn, options.killImpl);
  }
}
export async function readCodexQuota(options = {}) {
  if (options.signal?.aborted) return failure('codex-cancelled');
  let list = options.candidates;
  if (!Array.isArray(list)) list = options.exe ? [] : existingCodexCandidates(options.env ?? process.env, options.home ?? homedir());
  if (options.exe) list = [options.exe, ...list];
  const queue = [], seen = new Set();
  const attemptsLimit = options.retryCandidates === false ? 1
    : typeof options.maxAttempts === 'number' && Number.isFinite(options.maxAttempts)
      ? Math.max(1, Math.min(Math.floor(options.maxAttempts), 3)) : 3;
  for (const item of list) {
    const entry = typeof item === 'string' ? { path: item, shell: needsShell(item) } : item;
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)) continue;
    seen.add(entry.path); queue.push(entry);
    if (queue.length >= attemptsLimit) break;
  }
  if (!queue.length) return failure('codex-not-found');
  const budget = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 120000) : CODEX_DEFAULTS.timeoutMs;
  const deadline = Date.now() + budget, attempts = [];
  let result = failure('codex-not-found');
  for (let i = 0; i < queue.length; i++) {
    if (options.signal?.aborted) return failure('codex-cancelled');
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    result = await runSession(queue[i], { ...options, timeoutMs: Math.max(1, Math.floor(remaining / (queue.length - i))) });
    if (result.ok) return { ...result, attempts };
    attempts.push({ executable: fileName(queue[i].path), reason: result.reason });
    if (!['codex-spawn-failed', 'codex-exited', 'codex-no-answer', 'codex-init-failed', 'codex-invalid-command', 'codex-stream-error'].includes(result.reason)) break;
  }
  return { ...result, attempts };
}
export function readSnapshot(file, options = {}) {
  const target = file ?? defaultSnapshotPath(options.env ?? process.env, options.home ?? homedir());
  if (!target) return null;
  try {
    if (statSync(target).size > 1024 * 1024) return null;
    const doc = JSON.parse(readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    if (!doc || typeof doc !== 'object' || (doc.version !== undefined && doc.version !== 1)) return null;
    const at = typeof doc.generated === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(doc.generated) ? Date.parse(doc.generated) : NaN;
    const now = (options.now ?? Date.now)();
    if (!Number.isFinite(at) || at > now + 300000) return null;
    const pools = normalizedPools(doc.pools, true);
    if (!pools) return null;
    const count = numeric(doc.resetCredits?.availableCount);
    return { version: 1, generated: new Date(at).toISOString(), pools, accountPlan: planName(doc.accountPlan),
      resetCredits: Number.isInteger(count) && count >= 0 ? { availableCount: count } : null };
  } catch { return null; }
}
export async function readCodexQuotaWithFallback(options = {}) {
  const config = { ...CODEX_DEFAULTS, ...options.config };
  if (config.strategy === 'off') return failure('codex-disabled');
  const answer = config.strategy === 'snapshot' ? failure('codex-invalid-snapshot') : await readCodexQuota({ ...options, timeoutMs: config.timeoutMs });
  if (answer.ok) return { ...answer, source: 'codex-app-server' };
  if (['codex-cancelled', 'codex-not-signed-in', 'codex-api-key-account'].includes(answer.reason)) return answer;
  const snapshot = readSnapshot(config.snapshotPath, options);
  if (!snapshot) return answer;
  return { ok: true, source: 'snapshot', stale: true, readAt: snapshot.generated, staleReason: answer.reason,
    quota: { pools: snapshot.pools, accountPlan: snapshot.accountPlan, resetCredits: snapshot.resetCredits } };
}
