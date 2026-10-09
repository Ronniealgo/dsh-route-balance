// Explicit diagnostic: Codex may write its own runtime state. No inference sent.
// A quota snapshot is written only with --write or --out <file>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readCodexQuota, describeCodexQuota, nextResetAt, needsShell } from '../lib/codex.js';
export function parseOptions(args, env = process.env, home = os.homedir()) {
  const result = { json: false, write: false, exe: null, out: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'rate-limits.snapshot.json') };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') result.json = true;
    else if (arg === '--write') result.write = true;
    else if (arg === '--no-write') { /* Deprecated no-op: default is already no-write. */ }
    else if (arg === '--exe' || arg === '--out') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`missing value for ${arg}`);
      result[arg === '--exe' ? 'exe' : 'out'] = args[++i]; if (arg === '--out') result.write = true;
    } else throw new Error(`unknown option: ${arg}`);
  }
  return result;
}
export async function runQuota(args, deps = {}) {
  const options = parseOptions(args, deps.env, deps.home);
  const result = await (deps.read ?? readCodexQuota)({ ...(options.exe ? { exe: { path: options.exe, shell: needsShell(options.exe) }, retryCandidates: false } : {}), env: deps.env, home: deps.home });
  const report = { generated: new Date().toISOString(), ok: result.ok === true, reason: result.ok ? null : result.reason,
    text: describeCodexQuota(result), nextReset: nextResetAt(result), source: 'codex-app-server', snapshotWritten: false };
  if (result.ok && options.write) {
    const snapshot = { version: 1, generated: result.readAt ?? report.generated, accountPlan: result.quota.accountPlan ?? result.quota.planType ?? null, pools: result.quota.pools, resetCredits: result.quota.resetCredits ?? null };
    const file = path.resolve(options.out), temp = `${file}.tmp-${randomUUID()}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); report.snapshotWritten = true; }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  return { report, options };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const { report, options } = await runQuota(process.argv.slice(2)); console.log(options.json ? JSON.stringify(report, null, 2) : report.text); process.exitCode = report.ok ? 0 : 1; }
  catch { console.error('Codex quota diagnostic failed; check arguments, executable and snapshot output permissions.'); process.exitCode = 1; }
}
